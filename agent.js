// ─────────────────────────────────────────────────────────────────────────────
// Token Guard Agent v3 — Hackathon Edition
// Powered by Gemini & Dynatrace MCP Server
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const express                   = require('express');
const path                      = require('path');
const axios                     = require('axios');
const { GoogleGenerativeAI }    = require('@google/generative-ai');
const { Client }                = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport }    = require('@modelcontextprotocol/sdk/client/sse.js');

// ── Configuration ────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3000;
const DT_ENV_URL       = process.env.DT_ENVIRONMENT_URL;
const DT_TOKEN         = process.env.DT_PLATFORM_TOKEN;
const GEMINI_KEY       = process.env.GEMINI_API_KEY;

// Remote MCP Endpoint for Dynatrace
const DT_MCP_URL = `${DT_ENV_URL}/platform-reserved/mcp-gateway/v0.1/servers/dynatrace-mcp/mcp`;

const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const app   = express();
app.use(express.json());

// ── MCP Client Setup ─────────────────────────────────────────────────────────
let mcpClient = null;
let dynatraceTools = [];

async function initMCP() {
  try {
    console.log(`🔌 Connecting to Dynatrace MCP at: ${DT_MCP_URL}`);
    
    const transport = new SSEClientTransport(new URL(DT_MCP_URL), {
      eventSourceInit: {
        headers: {
          'Authorization': `Bearer ${DT_TOKEN}`
        }
      }
    });

    mcpClient = new Client({
      name: "token-guard-agent",
      version: "3.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    await mcpClient.connect(transport);
    
    // Discover available tools from Dynatrace
    const toolsResult = await mcpClient.listTools();
    dynatraceTools = toolsResult.tools || [];
    
    console.log(`✅ Connected to Dynatrace MCP. Discovered ${dynatraceTools.length} tools.`);
    return true;
  } catch (err) {
    console.error('❌ Failed to connect to Dynatrace MCP:', err.message);
    return false;
  }
}

// ── Internal Agent Tools (Legacy + New) ──────────────────────────────────────
const INTERNAL_TOOLS = [
  {
    name: 'analyze_prompt',
    description: 'Analyze a prompt for length, repetition, filler phrases, and clarity.',
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
    description: 'Rewrite a bloated prompt into a concise form.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt to rewrite' },
        reason: { type: 'string', description: 'Reason for optimization' }
      },
      required: ['prompt', 'reason']
    }
  },
  {
    name: 'approve_prompt',
    description: 'Approve a prompt without changes.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['prompt', 'reason']
    }
  }
];

// ── Tool Executors ────────────────────────────────────────────────────────────

async function executeInternalTool(name, args) {
  switch (name) {
    case 'analyze_prompt':
      const prompt = args.prompt;
      const len = prompt.length;
      const needsOpt = len > 100 || /\b(please|could you|i would like)\b/i.test(prompt);
      return {
        length: len,
        needs_optimization: needsOpt,
        estimated_savings: needsOpt ? '40%' : '0%'
      };

    case 'optimize_prompt':
      const optimizerModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const instruction = `Rewrite concisely: ${args.prompt}`;
      const res = await optimizerModel.generateContent(instruction);
      const optimized = res.response.text().trim();
      return {
        original: args.prompt,
        optimized,
        savings_percent: ((1 - optimized.length / args.prompt.length) * 100).toFixed(1)
      };

    case 'approve_prompt':
      return { original: args.prompt, optimized: args.prompt, savings_percent: '0.0' };

    default:
      throw new Error(`Unknown internal tool: ${name}`);
  }
}

async function executeMCPTool(name, args) {
  console.log(`🛠️ Calling Dynatrace MCP Tool: ${name}`);
  const result = await mcpClient.callTool({
    name,
    arguments: args
  });
  return result.content;
}

// ── Main Agent Loop ───────────────────────────────────────────────────────────

async function runAgent(userPrompt) {
  // Combine internal tools with discovered Dynatrace tools for Gemini
  const allTools = [
    ...INTERNAL_TOOLS.map(t => ({ functionDeclarations: [t] })),
    ...dynatraceTools.map(t => ({
      functionDeclarations: [{
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
      }]
    }))
  ];

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    tools: allTools
  });

  const chat = model.startChat();
  const steps = [];
  
  const systemPrompt = 
    `You are Token Guard v3, an autonomous agent. Your mission is to optimize prompt costs ` +
    `while using Dynatrace observability to monitor usage.\n\n` +
    `PROTOCOL:\n` +
    `1. Use analyze_prompt to check the input.\n` +
    `2. If you need context (like current logs or budget), use Dynatrace tools like 'execute_dql'.\n` +
    `3. Decide to optimize, approve, or flag.\n\n` +
    `User Prompt: "${userPrompt}"`;

  let response = await chat.sendMessage(systemPrompt);
  let iter = 0;

  while (iter < 5) {
    iter++;
    const calls = response.response.functionCalls();
    if (!calls) break;

    const functionResponses = [];
    for (const call of calls) {
      console.log(`🏃 Step ${steps.length + 1}: ${call.name}`);
      let result;
      
      if (INTERNAL_TOOLS.find(t => t.name === call.name)) {
        result = await executeInternalTool(call.name, call.args);
      } else {
        result = await executeMCPTool(call.name, call.args);
      }

      steps.push({ tool: call.name, input: call.args, output: result });
      functionResponses.push({ functionResponse: { name: call.name, response: result } });
    }
    response = await chat.sendMessage(functionResponses);
  }

  const finalDecision = steps.find(s => ['optimize_prompt', 'approve_prompt'].includes(s.tool));
  return { steps, result: finalDecision?.output || { optimized: userPrompt, savings_percent: '0.0' } };
}

// ── Express Endpoints ─────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/guard', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const { steps, result } = await runAgent(prompt);
    res.json({
      status: 'success',
      original_length: prompt.length,
      new_length: result.optimized?.length || prompt.length,
      savings_percent: result.savings_percent || '0.0',
      final_prompt: result.optimized || prompt,
      agent_steps: steps
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Agent Error', details: err.message });
  }
});

// ── Start Server ──────────────────────────────────────────────────────────────
async function start() {
  await initMCP();
  app.listen(PORT, () => {
    console.log(`\n🚀 Token Guard v3 LIVE on port ${PORT}`);
  });
}

start();
