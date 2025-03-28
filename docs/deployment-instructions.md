# Deployment Instructions

This document outlines the steps for deploying the Browser-Use Service and its associated frontend application.

## Prerequisites

- Node.js v18+ for the frontend
- Python 3.10+ for the backend service
- Docker and Docker Compose for containerized deployment
- A cloud provider account (AWS, GCP, Azure, etc.)

## Local Development Setup

### Backend (Browser-Use Service)

1. Clone the repository:
   ```bash
   git clone https://github.com/your-organization/browser-use-service.git
   cd browser-use-service
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up environment variables by copying the example file:
   ```bash
   cp .env.example .env
   ```
   
5. Edit the `.env` file with your specific configurations.

6. Run the service:
   ```bash
   python -m app.main
   ```

### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file with the appropriate settings:
   ```
   NEXT_PUBLIC_BROWSER_USE_API=http://localhost:8003
   ```

4. Start the development server:
   ```