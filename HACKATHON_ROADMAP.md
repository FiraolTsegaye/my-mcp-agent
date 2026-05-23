# Token Guard: Hackathon Roadmap & Architecture

## 1. Project Overview
The goal is to transform the existing "Token Guard" project into a hackathon-compliant submission for the Google Cloud Rapid Agent Hackathon. The hackathon requires building a functional agent powered by Gemini and Google Cloud Agent Builder that integrates a partner's MCP server to solve a real-world challenge.

The current Token Guard is an AI agent middleware that optimizes prompts to save API token costs. We will enhance it by integrating the **Dynatrace MCP Server** to provide real-time observability, cost tracking, and automated anomaly detection based on the token usage data.

## 2. Architectural Design

### Current Architecture
- **Backend:** Node.js, Express.js
- **AI:** Google Gemini SDK (`gemini-2.0-flash`)
- **Observability:** Dynatrace API (direct HTTP POST for logs)
- **Tracing:** OpenTelemetry (Phoenix/Arize)

### Target Architecture (Hackathon Compliant)
- **Backend:** Node.js, Express.js (deployed on Google Cloud Run)
- **AI Engine:** Google Cloud Vertex AI Agent Engine / Gemini
- **MCP Integration:** 
  - **Dynatrace MCP Server:** Used to query real-time observability data, track token savings, and detect anomalies in API usage.
- **Action Workflows:**
  - The agent will not only optimize prompts but also use the Dynatrace MCP server to check current budget limits, query historical usage, and alert on unusual spikes in token consumption.

## 3. Roadmap

### Phase 1: Setup and Google Cloud Preparation
- [ ] Claim Google Cloud credits or set up a free trial.
- [ ] Create a new Google Cloud Project.
- [ ] Enable necessary APIs (Vertex AI, Cloud Run, IAM).
- [ ] Set up Google Cloud CLI (`gcloud`) in the development environment.

### Phase 2: Dynatrace MCP Server Integration
- [ ] Obtain a Dynatrace environment URL and Platform Token.
- [ ] Configure the Dynatrace MCP server connection in the agent.
- [ ] Replace the current direct HTTP logging to Dynatrace with MCP-based interactions (e.g., querying Grail for usage stats).
- [ ] Add new agent tools that leverage the Dynatrace MCP server (e.g., `check_budget`, `analyze_usage_trend`).

### Phase 3: Google Cloud Agent Builder / Vertex AI Integration
- [ ] Migrate from the standard `@google/generative-ai` SDK to the Google Cloud Vertex AI SDK if necessary for Agent Builder compliance.
- [ ] Implement the agent logic using Google-managed MCP servers or the Agent Development Kit (ADK) if applicable.
- [ ] Ensure the agent can handle multi-step tasks involving both prompt optimization and Dynatrace data querying.

### Phase 4: Action-Oriented Workflows
- [ ] Implement a workflow where the agent checks the Dynatrace budget before optimizing a large prompt.
- [ ] If the budget is near the limit, the agent can proactively suggest more aggressive optimization or flag the prompt.
- [ ] Create a dashboard view (updating `index.html`) to show real-time Dynatrace insights fetched via the MCP server.

### Phase 5: Deployment and Submission
- [ ] Containerize the application (update `Dockerfile` if needed).
- [ ] Deploy to Google Cloud Run.
- [ ] Record a demo video showcasing the multi-step agent actions and Dynatrace integration.
- [ ] Write the Devpost submission detailing the real-world challenge (API cost management) and the solution.

## 4. Required Materials & Credentials
- **Google Cloud Account:** With billing enabled or credits applied.
- **Dynatrace Account:** Access to a Dynatrace environment (URL) and a Platform Token with `mcp-gateway:servers:invoke` and `mcp-gateway:servers:read` permissions.
- **Gemini API Key / Vertex AI Access:** For the core LLM capabilities.

## 5. Next Steps
1. User needs to confirm if they have a Dynatrace account/environment available.
2. User needs to set up the Google Cloud project and provide the necessary credentials.
3. We will begin modifying `agent.js` to integrate the Dynatrace MCP client.
