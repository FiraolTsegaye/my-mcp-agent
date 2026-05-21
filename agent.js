const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());

// Initialize Gemini - Using 1.5-flash for maximum compatibility
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

/**
 * Telemetry Function: Sends logs to Dynatrace Grail
 */
async function sendToDynatrace(savingsPercent, originalLength) {
    // Ensure the URL is properly formatted
    const baseUrl = process.env.DYNATRACE_URL.endsWith('/') 
        ? process.env.DYNATRACE_URL.slice(0, -1) 
        : process.env.DYNATRACE_URL;
        
    const url = `${baseUrl}/api/v2/logs/ingest`;
    
    const logData = [{
        "content": `Token Guard optimization event: Saved ${savingsPercent}%`,
        "severity": "info",
        "attributes": {
            "token_savings_percent": parseFloat(savingsPercent),
            "original_length": originalLength,
            "service.name": "Token-Guard-Mobile",
            "developer": "Fira"
        }
    }];

    try {
        await axios.post(url, logData, {
            headers: { 
                'Authorization': `Api-Token ${process.env.DYNATRACE_API_KEY}`, 
                'Content-Type': 'application/json' 
            }
        });
        console.log("📡 Telemetry successfully sent to Dynatrace.");
    } catch (err) {
        // Detailed error logging for debugging API issues
        const errorMsg = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error("❌ Telemetry failed:", errorMsg);
    }
}

// Serve the Frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/**
 * Main Guard Route: Logic + AI + Telemetry
 */
app.post('/guard', async (req, res) => {
  console.log("📥 [Incoming] Request received!"); // Add this line
    const userPrompt = req.body.prompt;
    console.log(`📏 [Length Check] Prompt is ${userPrompt ? userPrompt.length : 0} chars long.`); 
  
    
    if (!userPrompt) {
        return res.status(400).json({ error: "No prompt provided." });
    }

    // Threshold logic: Only optimize if prompt is long
    if (userPrompt.length > 100) {
        console.log(`\n[🔍 Processing] Length: ${userPrompt.length} chars`);
        
        try {
            const instruction = `Rewrite this to be as short as possible while keeping the core request: ${userPrompt}`;
            const result = await model.generateContent(instruction);
            const optimized = result.response.text().trim();
            
            // Calculate Savings
            const savings = ((1 - (optimized.length / userPrompt.length)) * 100).toFixed(1);
            
            console.log(`✅ Optimized! Saved ${savings}%`);

            // Fire and forget telemetry so it doesn't slow down the response
            sendToDynatrace(savings, userPrompt.length).catch(e => console.error(e));

            res.json({
                status: "optimized",
                original_length: userPrompt.length,
                new_length: optimized.length,
                savings_percent: savings,
                final_prompt: optimized
            });
        } catch (error) {
            console.error("❌ Gemini API Error:", error.message);
            res.status(500).json({ error: "Failed to reach AI brain." });
        }
    } else {
        console.log("✅ Request efficient. Passing through.");
        res.json({ 
            status: "passed", 
            savings_percent: 0,
            final_prompt: userPrompt 
        });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🛡️  Token Guard is LIVE`);
    console.log(`🔗  Dashboard: http://localhost:${PORT}`);
    console.log(`📡  Dynatrace: ${process.env.DYNATRACE_URL}`);
});
