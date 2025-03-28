# Integration Outline: Integrating Browser-Use into Autonomi

This document outlines the plan and step-by-step instructions for integrating Browser-Use (a Python-based automation engine) into Autonomi’s environment (Next.js/Node + Playwright). The goal is to leverage Browser-Use’s multi-step workflow, speed, and reliability while preserving Autonomi’s user-facing interface.

---

## 1. Overview and Goals

- **Objective:** Enable Autonomi to prospect leads on LinkedIn Sales Navigator by combining its existing UI/Playwright browser embedding with Browser-Use’s advanced agent orchestration.
- **Key Benefits:**
  - **Multi-step workflows:** Execute multiple actions (navigate, click, input, etc.) in a single LLM call.
  - **Faster execution:** Fewer round-trips to the LLM via action grouping.
  - **Improved reliability:** Structured controller actions with error handling and state validation.
- **Target Use-Case:** Automatically identify key personas, save them to lists, and send connection requests/messages on LinkedIn Sales Navigator.

---

## 2. Integration Approach (Option A)

- **Modular Reuse:** Set up Browser-Use as a separate Python service within Autonomi’s environment.
- **Communication Bridge:** Autonomi (Next.js) will send task definitions to the Browser-Use service via an API.
- **Advantages:**
  - Minimal disruption to the existing Autonomi frontend.
  - Leverage the mature Browser-Use architecture without needing a full reimplementation.

---

## 3. Architecture Mapping

### Autonomi’s Current Components:
- **Frontend:** Next.js-based chat interface.
- **Backend:** Node.js with embedded Playwright browser control.
- **Task Execution:** Basic, one-step LLM prompting with direct Playwright calls.

### Browser-Use Components to Integrate:
- **Agent Loop:** Iterative multi-step action planner using structured LLM outputs.
- **Controller & Actions:** Modular actions (e.g., navigate, click, type) registered in a Controller.
- **State Management:** Enhanced browser state and error-checking mechanisms.
- **LLM Integration:** Structured prompting and multi-action outputs via LangChain.

### Mapping Strategy:
- **Replace/Wrap Agent Execution:** Autonomi will call Browser-Use’s `Agent.run()` to execute tasks.
- **Custom Actions:** Extend Browser-Use’s controller with LinkedIn-specific functions (e.g., `save_profile`, `connect_profile`).
- **Session Management:** Leverage Playwright’s context handling to persist login sessions (use cookie reuse for LinkedIn).
- **UI Updates:** Stream Browser-Use’s progress (agent history) back to the Autonomi frontend.

---

## 4. Step-by-Step Integration Instructions

### Step 1: Environment Setup
- **Install Browser-Use:**
  - Add Browser-Use to your project’s Python environment (e.g., update `requirements.txt` or use a virtualenv).
  - Ensure Playwright is installed and configured in Python:
    - Run: `pip install browser-use`
    - Install browser binaries with: `playwright install chromium`
- **Prepare Communication Bridge:**
  - Create a Python microservice (e.g., using FastAPI or Flask) to expose an endpoint (e.g., `/runAgent`).
  - This endpoint will accept JSON payloads containing task definitions.

### Step 2: Define the Integration API
- **Create an API endpoint in Python:**
  - Accept a POST request with parameters such as the LinkedIn search criteria, target list name, and other configuration options.
  - Example payload:
    ```json
    {
      "task": "Prospect leads on LinkedIn Sales Navigator: find key personas, save to list 'Target Leads', send connection invites with message 'Hi, let's connect!'",
      "max_steps": 50
    }
    ```
- **Implement the Endpoint Logic:**
  - Instantiate the Browser-Use agent with the provided task.
  - Call `Agent.run(max_steps=<max_steps>)` and capture the agent’s execution history.
  - Return a summary result as JSON to Autonomi.

### Step 3: Implement Custom LinkedIn Actions
- **Extend Browser-Use’s Controller:**
  - Write custom actions such as:
    - `open_sales_nav_search(query)`
    - `save_profile(profile_identifier)`
    - `connect_profile(profile_identifier, message)`
    - `send_message(profile_identifier, message)`
  - Each action should use the Browser-Use `Browser` object to locate UI elements, click buttons, and input text reliably.
- **Register these actions:**
  - Add them to the Controller’s registry so that the LLM agent can call them by name.

### Step 4: Session and Authentication Management
- **Implement a Login Routine:**
  - Create a script or a custom action that opens a Playwright-controlled browser window to navigate to LinkedIn.
  - Allow the user to manually log in (or prompt for credentials securely).
  - Save the session cookies to a file.
- **Load Session Cookies:**
  - When initializing the Browser-Use agent’s `BrowserContext`, load the stored cookies so that the agent operates in an authenticated session.

### Step 5: Integrate Agent Execution into Autonomi Frontend
- **Bridge Communication:**
  - In the Autonomi Next.js backend, create an API route that sends a task to the Python service.
  - Use HTTP (or WebSocket) to initiate the agent run and stream back progress updates.
- **Display Progress:**
  - Implement a log viewer or progress tracker on the Autonomi UI that shows each step from the Browser-Use agent’s history (e.g., “Step 1: Navigated to Sales Navigator”, “Step 2: Found 10 profiles”, etc.).
- **Handle Final Output:**
  - Once the agent finishes, display a summary (number of profiles saved, connection invites sent, etc.).
  - Optionally, display a structured output (e.g., a table of processed leads).

### Step 6: Testing and Iteration
- **Dry Runs:**
  - Run the agent on a test LinkedIn account with sample search criteria.
  - Validate that each action (navigation, saving, connecting) works as expected.
- **Monitor Metrics:**
  - Measure task completion time, number of LLM calls per lead, and error rates.
  - Adjust delays, custom actions, or prompt instructions as needed to optimize reliability.
- **Iterate:**
  - Based on test results, refine custom actions and the overall agent prompt.
  - Document any quirks (e.g., waiting times, UI selector changes) for future reference.

### Step 7: Documentation and Deployment
- **Document the Setup:**
  - Update your project’s README with instructions on setting up the Python service, logging into LinkedIn, and running the integrated agent.
- **Deploy:**
  - Once tested, deploy the Python service alongside the Autonomi backend.
  - Ensure environment variables (such as OpenAI API keys and LinkedIn session details) are securely managed.

---

## 5. Success Metrics & Monitoring

- **Task Completion Rate:** Target > 90% success on complete LinkedIn prospecting runs.
- **Execution Speed:** Aim for < 10 seconds per lead (excluding login).
- **LLM Efficiency:** Reduce the average number of LLM calls per lead to fewer than 3.
- **Accuracy:** Ensure correct identification and action on target profiles (error rate < 5%).

---

## 6. Additional Notes

- **Rate Limiting:** Add delays or randomness to mimic human behavior to avoid LinkedIn rate limits or CAPTCHAs.
- **Error Handling:** Implement fallback actions or user prompts if the agent encounters unexpected UI changes.
- **Scalability:** Consider future enhancements (e.g., parallel processing for multiple search result pages) once the basic integration is stable.

---

## Conclusion

By following this outline, you will integrate Browser-Use’s powerful multi-step automation into Autonomi while maintaining its intuitive UI. This integration will result in a faster, more reliable solution for LinkedIn Sales Navigator lead prospecting, ultimately saving manual effort and increasing automation accuracy.

---

*End of Integration Outline*
