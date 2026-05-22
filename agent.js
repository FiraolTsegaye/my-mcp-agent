// ─────────────────────────────────────────────────────────────────────────────
// Token Guard Agent v2
// An autonomous AI agent that guards API token costs using:
//   - Gemini function calling (multi-step tool use)
//   - Phoenix/Arize OpenTelemetry tracing (partner integration)
//   - Dynatrace Grail telemetry
//   - Cloud Run ready Express server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

// ── Phoenix / OpenTelemetry — must initialise before anything else ────────────
const { NodeSDK }            = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter }  = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource }           = require('@opentelemetry/resources');
const { trace, SpanStatusCode, context } = require('@opentelemetry/api');

const sdk = new NodeSDK({
  resource: new Resource({ 'service.name': 'token-guard-agent', 'service.version': '2.0.0' }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006/v1/traces',
  }),
});

sdk.start();
console.log('🔭 Phoenix/Arize tracing initialised →', process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006');

const tracer = trace.getTracer('token-guard-agent', '2.0.0');

// ── Core dependencies ─────────────────────────────────────────────────────────
const express                   = require('express');
const path                      = require('path');
const axios                     = require('axios');
const { GoogleGenerativeAI }    = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Agent tool declarations (Gemini function calling) ─────────────────────────
const AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: 'analyze_prompt',
      description: 'Analyze a prompt for length, repetition, filler phrases, and clarity. Always call this first before making any decision.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt to analyze' }
        },
        required: ['prompt']
      }
    },
    {
      name: 'optimize_prompt',
      description: 'Rewrite a bloated or verbose prompt into the shortest possible form that preserves full intent. Use when analysis shows optimization is needed.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt to rewrite' },
          reason: { type: 'string', description: 'Why this prompt needs optimization (e.g. "too long", "repetitive", "filler phrases")' }
        },
        required: ['prompt', 'reason']
      }
    },
    {
      name: 'approve_prompt',
      description: 'Approve a prompt to pass through unchanged. Use when the prompt is already concise and well-formed.',
      parameters: {
        type: 'object',
        properties: {
          prompt:  { type: 'string', description: 'The prompt being approved' },
          reason:  { type: 'string', description: 'Why this prompt passes without changes' }
        },
        required: ['prompt', 'reason']
      }
    },
    {
      name: 'flag_prompt',
      description: 'Flag a prompt as problematic without blocking it. Use when the prompt is ambiguous, contradictory, or contains potential data leakage patterns.',
      parameters: {
        type: 'object',
        properties: {
          prompt:   { type: 'string', description: 'The prompt being flagged' },
          issue:    { type: 'string', description: 'Description of the issue detected' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Severity of the issue' }
        },
        required: ['prompt', 'issue', 'severity']
      }
    }
  ]
}];

// Agent model (function calling enabled)
const agentModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', tools: AGENT_TOOLS });

// Separate model for the actual prompt rewriting (no tools needed)
const optimizerModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// ── Tool Executors ────────────────────────────────────────────────────────────

/**
 * analyze_prompt — rule-based, no extra LLM call, returns structured report
 */
function analyzePrompt({ prompt }) {
  const len         = prompt.length;
  const words       = prompt.trim().split(/\s+/);
  const wordCount   = words.length;
  const sentences   = (prompt.match(/[.!?]+/g) || []).length || 1;
  const avgWPS      = Math.round(wordCount / sentences);

  const hasRepetition   = /(\b\w{4,}\b)(?:\s+\S+){0,8}\s+\1/i.test(prompt);
  const hasFillerPhrases = /\b(please note that|it is important to|as you (may )?know|in order to|due to the fact that|for the purpose of|i would like you to|i want you to|can you please|could you please)\b/i.test(prompt);
  const hasPotentialPII  = /\b(\d{3}[-.\s]?\d{2}[-.\s]?\d{4}|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d{16}\b)/i.test(prompt);
  const isAmbiguous      = wordCount < 5 && !prompt.includes('?');

  const needsOptimization = len > 100 || hasRepetition || hasFillerPhrases;
  const estimatedSavings  = needsOptimization
    ? Math.min(65, Math.round(((len - 80) / len) * 100 + (hasRepetition ? 10 : 0) + (hasFillerPhrases ? 8 : 0)))
    : 0;

  return {
    length:                len,
    word_count:            wordCount,
    sentence_count:        sentences,
    avg_words_per_sentence: avgWPS,
    has_repetition:        hasRepetition,
    has_filler_phrases:    hasFillerPhrases,
    has_potential_pii:     hasPotentialPII,
    is_ambiguous:          isAmbiguous,
    needs_optimization:    needsOptimization,
    estimated_savings_pct: estimatedSavings,
  };
}

/**
 * optimize_prompt — calls Gemini to do the actual rewrite
 */
async function optimizePrompt({ prompt, reason }) {
  const instruction =
    `You are a prompt compression engine. Rewrite the prompt below to be as short as possible ` +
    `while preserving every part of its original intent. Remove filler words, redundancy, unnecessary ` +
    `preamble, and politeness padding. Do not add any explanation or preamble — output only the rewritten prompt.\n\n` +
    `Prompt: ${prompt}`;

  const result    = await optimizerModel.generateContent(instruction);
  const optimized = result.response.text().trim();
  const savings   = ((1 - optimized.length / prompt.length) * 100).toFixed(1);

  return {
    original:        prompt,
    optimized,
    original_length: prompt.length,
    new_length:      optimized.length,
    savings_percent: savings,
    reason,
  };
}

/**
 * approve_prompt — no transformation, just packages the pass-through
 */
function approvePrompt({ prompt, reason }) {
  return {
    original:        prompt,
    optimized:       prompt,
    original_length: prompt.length,
    new_length:      prompt.length,
    savings_percent: '0.0',
    reason,
  };
}

/**
 * flag_prompt — flags without blocking; still returns the original prompt
 */
function flagPrompt({ prompt, issue, severity }) {
  return {
    original:        prompt,
    optimized:       prompt,
    original_length: prompt.length,
    new_length:      prompt.length,
    savings_percent: '0.0',
    flagged:         true,
    issue,
    severity,
  };
}

/**
 * executeTool — dispatches to the right executor and wraps the call in an OTEL span
 */
async function executeTool(name, args, parentSpan) {
  const ctx       = trace.setSpan(context.active(), parentSpan);
  const toolSpan  = tracer.startSpan(`tool.${name}`, {}, ctx);

  toolSpan.setAttributes({
    'tool.name':  name,
    'tool.input': JSON.stringify(args).slice(0, 500),
  });

  try {
    let result;
    switch (name) {
      case 'analyze_prompt':  result = analyzePrompt(args);             break;
      case 'optimize_prompt': result = await optimizePrompt(args);      break;
      case 'approve_prompt':  result = approvePrompt(args);             break;
      case 'flag_prompt':     result = flagPrompt(args);                break;
      default:                result = { error: `Unknown tool: ${name}` };
    }

    toolSpan.setAttributes({
      'tool.output':  JSON.stringify(result).slice(0, 500),
      'tool.success': true,
    });
    toolSpan.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    throw err;
  } finally {
    toolSpan.end();
  }
}

// ── Agent Loop ────────────────────────────────────────────────────────────────

/**
 * runAgent — the main agentic loop.
 * Sends prompt to Gemini with tools available, then keeps responding to
 * function calls until the agent reaches a terminal decision.
 */
async function runAgent(userPrompt) {
  const agentSpan = tracer.startSpan('agent.run');
  agentSpan.setAttributes({
    'agent.prompt_length':  userPrompt.length,
    'agent.prompt_preview': userPrompt.slice(0, 120),
    'agent.model':          'gemini-1.5-flash',
  });

  const steps       = [];
  let   finalResult = null;

  try {
    const chat = agentModel.startChat();

    const systemPrompt =
      `You are Token Guard, an autonomous AI agent that protects LLM API costs by intelligently ` +
      `managing prompts before they reach downstream models.\n\n` +
      `Your decision protocol:\n` +
      `1. ALWAYS call analyze_prompt first to understand the input\n` +
      `2. Read the analysis, then take exactly ONE terminal action:\n` +
      `   - optimize_prompt  → if needs_optimization is true\n` +
      `   - flag_prompt      → if has_potential_pii is true OR the prompt is dangerously ambiguous\n` +
      `   - approve_prompt   → if the prompt is already concise and safe\n` +
      `3. Do not call more than one terminal action. Stop after your decision.\n\n` +
      `Process this prompt now: "${userPrompt}"`;

    let   response      = await chat.sendMessage(systemPrompt);
    const MAX_ITER      = 8;
    let   iter          = 0;

    while (iter < MAX_ITER) {
      iter++;
      const functionCalls = response.response.functionCalls();

      if (!functionCalls || functionCalls.length === 0) break; // agent done

      const functionResponses = [];

      for (const fc of functionCalls) {
        const stepEntry = {
          step:      steps.length + 1,
          tool:      fc.name,
          input:     fc.args,
          timestamp: new Date().toISOString(),
        };
        steps.push(stepEntry);

        const result   = await executeTool(fc.name, fc.args, agentSpan);
        stepEntry.output = result;

        // Capture terminal decision
        if (['optimize_prompt', 'approve_prompt', 'flag_prompt'].includes(fc.name)) {
          finalResult = { action: fc.name, ...result };
        }

        functionResponses.push({ functionResponse: { name: fc.name, response: result } });
      }

      response = await chat.sendMessage(functionResponses);
    }

    agentSpan.setAttributes({
      'agent.steps_taken':  steps.length,
      'agent.final_action': finalResult?.action || 'unknown',
      'agent.savings_pct':  parseFloat(finalResult?.savings_percent || 0),
    });
    agentSpan.setStatus({ code: SpanStatusCode.OK });

    return { steps, result: finalResult };
  } catch (err) {
    agentSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    throw err;
  } finally {
    agentSpan.end();
  }
}

// ── Dynatrace Telemetry ───────────────────────────────────────────────────────
async function sendToDynatrace(savingsPct, originalLen, action) {
  const base = process.env.DYNATRACE_URL;
  if (!base) return;

  const url = `${base.replace(/\/$/, '')}/api/v2/logs/ingest`;

  await axios.post(url, [{
    content:  `Token Guard agent: action=${action} saved=${savingsPct}%`,
    severity: 'info',
    attributes: {
      token_savings_percent: parseFloat(savingsPct),
      original_length:       originalLen,
      agent_action:          action,
      'service.name':        'Token-Guard-Agent',
    }
  }], {
    headers: {
      Authorization:  `Api-Token ${process.env.DYNATRACE_API_KEY}`,
      'Content-Type': 'application/json',
    }
  });
}

// ── Express Server ────────────────────────────────────────────────────────────
const app   = express();
const PORT  = process.env.PORT || 3000;
app.use(express.json());

const sessionHistory = [];

app.get('/',  (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Main guard endpoint
app.post('/guard', async (req, res) => {
  const userPrompt = req.body.prompt;
  console.log(`\n📥 [Agent] Prompt received — ${userPrompt?.length || 0} chars`);

  if (!userPrompt) return res.status(400).json({ error: 'No prompt provided.' });

  try {
    const { steps, result } = await runAgent(userPrompt);
    console.log(`✅ [Agent] Done in ${steps.length} steps → ${result?.action}`);

    // Fire-and-forget telemetry
    sendToDynatrace(result?.savings_percent || '0.0', userPrompt.length, result?.action)
      .catch(e => console.error('Dynatrace error:', e.message));

    sessionHistory.unshift({
      timestamp:       new Date().toISOString(),
      status:          result?.action || 'unknown',
      original_length: userPrompt.length,
      new_length:      result?.new_length || userPrompt.length,
      savings_percent: result?.savings_percent || '0.0',
      steps_taken:     steps.length,
      flagged:         result?.flagged || false,
      preview:         userPrompt.slice(0, 80) + (userPrompt.length > 80 ? '…' : ''),
    });

    res.json({
      status:          result?.action || 'unknown',
      original_length: userPrompt.length,
      new_length:      result?.new_length || userPrompt.length,
      savings_percent: result?.savings_percent || '0.0',
      final_prompt:    result?.optimized || userPrompt,
      flagged:         result?.flagged || false,
      flag_issue:      result?.issue || null,
      flag_severity:   result?.severity || null,
      agent_steps:     steps,
    });
  } catch (err) {
    console.error('❌ Agent error:', err.message);
    res.status(500).json({ error: 'Agent failed.', detail: err.message });
  }
});

app.get('/history',    (_req, res) => res.json(sessionHistory));
app.delete('/history', (_req, res) => { sessionHistory.length = 0; res.json({ message: 'Cleared.' }); });

app.listen(PORT, () => {
  console.log(`\n🛡️  Token Guard Agent v2 LIVE`);
  console.log(`🔗  Dashboard  → http://localhost:${PORT}`);
  console.log(`🔭  Phoenix    → ${process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006'}`);
  console.log(`📡  Dynatrace  → ${process.env.DYNATRACE_URL || '(not set)'}\n`);
});
