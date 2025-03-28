# Browser-Use Integration Platform

A platform for automating browser tasks using an intelligent agent with a modern web UI.

## Overview

This project consists of two main components:

1. **Frontend**: A Next.js application that provides a user interface for interacting with the browser automation service.
2. **Browser-Use Service**: A Python FastAPI backend that handles browser automation tasks using Playwright.

## Quick Start

### Backend Setup
1. `cd browser-use-service`
2. `python -m venv venv`
3. `source venv/bin/activate` (or `venv\Scripts\activate` on Windows)
4. `pip install -r requirements.txt`
5. `python -m app.main`

### Frontend Setup
1. `cd frontend`
2. `npm install` (or `pnpm install`)
3. `npm run dev` (or `pnpm run dev`)

## Documentation

For detailed documentation, refer to the following guides:

- [API Documentation](docs/api-documentation.md)
- [Deployment Instructions](docs/deployment-instructions.md)
- [Monitoring Setup](docs/monitoring-setup.md)
- [Troubleshooting Guide](docs/troubleshooting-guide.md)

## Development Notes

- We're using uv pip for package management
- llm-reader uses selenium under the hood, which is important to note for efficiency considering we're using Playwright

## License

[MIT License](LICENSE)