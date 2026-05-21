 🛡️ Token Guard: AI Cost Optimizer

A mobile-first AI agent that intercepts "bloated" prompts and optimizes them using Gemini 1.5 Flash before they hit the API. Built entirely on Android via Termux and Acode.

 Features
- Token Optimization: Uses AI to rewrite long prompts, saving up to 88% in token costs.
- Real-time Observability:** Every optimization event is sent as telemetry to Dynatrace Grail.
- Mobile-Native: Developed and deployed using a phone-based stack.

️ Tech Stack
- **Backend:** Node.js, Express.js
- **AI:** Google Gemini SDK
- **Observability:** Dynatrace API (OpenPipeline & Grail)
- **Environment:** Termux & Acode (Android)

 Telemetry
Metrics sent to Dynatrace include:
- `token_savings_percent`
- `original_length`
- `service.name`

