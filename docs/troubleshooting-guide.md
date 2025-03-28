# Troubleshooting Guide

This guide provides solutions for common issues that may arise when working with the Browser-Use Service and frontend application.

## Table of Contents

1. [Backend Service Issues](#backend-service-issues)
2. [Frontend Application Issues](#frontend-application-issues)
3. [Integration Issues](#integration-issues)
4. [Browser Automation Issues](#browser-automation-issues)
5. [Deployment Issues](#deployment-issues)

## Backend Service Issues

### Service Won't Start

**Symptoms**:
- Error: `Address already in use`
- Service crashes immediately after starting

**Solutions**:
1. Check if another process is using the same port:
   ```bash
   # For Linux/Mac
   lsof -i :8003
   
   # For Windows
   netstat -ano | findstr :8003
   ```

2. Kill the process using the port:
   ```bash
   # For Linux/Mac
   kill -9 <PID>
   
   # For Windows
   taskkill /PID <PID> /F
   ```

3. Change the port in `.env` file if needed.

### Database Connection Issues

**Symptoms**:
- Error messages about database connection failures
- Tasks not being saved

**Solutions**:
1. Verify database credentials in `.env` file
2. Check if the database server is running
3. Ensure network connectivity to the database
4. Check for firewall or security group restrictions

### Missing Dependencies

**Symptoms**:
- `ModuleNotFoundError` when starting the service
- Unexpected import errors

**Solutions**:
1. Make sure you've activated the virtual environment:
   ```bash
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Reinstall dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Frontend Application Issues

### Blank Page / UI Not Rendering

**Symptoms**:
- Blank white page when accessing the application
- No visible UI elements

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify that the API URL is correctly set in `.env.local`
3. Ensure environment variables are properly exposed to the frontend
4. Rebuild the frontend application:
   ```bash
   npm run build
   npm run start
   ```

### CSS Issues

**Symptoms**:
- Broken layouts
- Missing styles
- Tailwind classes not applying correctly

**Solutions**:
1. Check for Tailwind configuration issues:
   ```bash
   # Check if tailwind is properly configured
   npx tailwindcss --help
   ```

2. Restart the development server with a clean cache:
   ```bash
   npm run dev -- --clear-cache
   ```

3. Make sure the global CSS file is properly importing Tailwind:
   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

### Server-Side Rendering Issues

**Symptoms**:
- Hydration errors in console
- UI elements flickering or changing after initial load

**Solutions**:
1. Ensure any browser-specific code is wrapped in useEffect or only runs client-side:
   ```typescript
   import { useEffect, useState } from 'react';
   
   function Component() {
     const [isMounted, setIsMounted] = useState(false);
     
     useEffect(() => {
       setIsMounted(true);
     }, []);
     
     if (!isMounted) return null;
     
     // Browser-only code here
     return <div>...</div>;
   }
   ```

2. Check for mismatches between server and client rendering

## Integration Issues

### API Communication Errors

**Symptoms**:
- 500 Internal Server errors when calling API endpoints
- Frontend cannot connect to backend

**Solutions**:
1. Check that backend service is running and accessible
2. Verify API endpoint URLs in the frontend code
3. Check for CORS issues (in development):
   ```python
   # In FastAPI app
   from fastapi.middleware.cors import CORSMiddleware
   
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:3000"],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

4. Verify that the request payload matches the expected format

### Missing LLM Configuration

**Symptoms**:
- Error: `'dict' object has no attribute 'llm'`
- Tasks fail to start

**Solutions**:
1. Ensure the API request includes the required LLM configuration:
   ```javascript
   const payload = {
     task: "Example task",
     max_steps: 10,
     config: {
       llm: {
         provider: "openai",
         model: "gpt-4"
       }
     },
     browser_info: {
       browser_type: "chromium",
       headless: true
     }
   };
   ```

2. Check backend logs for detailed error messages

## Browser Automation Issues

### Browser Crashes

**Symptoms**:
- Tasks fail with browser-related errors
- Playwright/Chromium crashes

**Solutions**:
1. Update Playwright:
   ```bash
   pip install --upgrade playwright
   playwright install
   ```

2. Check system resources (memory, CPU) during browser operations
3. Reduce concurrency of browser tasks if system is constrained
4. Try running in non-headless mode for debugging:
   ```python
   browser = await playwright.chromium.launch(headless=False)
   ```

### Screenshot Issues

**Symptoms**:
- Missing or corrupted screenshots
- Black screenshots

**Solutions**:
1. Ensure the browser has fully loaded the page before taking screenshots
2. Check for permission issues in the directory where screenshots are saved
3. Try different screenshot formats (PNG vs JPEG)
4. Verify that the screenshot element is visible in the DOM

## Deployment Issues

### Docker Deployment Problems

**Symptoms**:
- Container fails to start
- Services cannot communicate with each other

**Solutions**:
1. Check Docker logs:
   ```bash
   docker logs <container-id>
   ```

2. Verify environment variables in the Docker Compose file
3. Ensure network configuration allows containers to communicate
4. Check for volume mount issues if using persistent storage

### Cloud Deployment Issues

**Symptoms**:
- Service unavailable after deployment
- Unexpected behavior in production

**Solutions**:
1. Check cloud provider logs (CloudWatch, Cloud Logging, etc.)
2. Verify environment variables in the cloud configuration
3. Check for network or security group issues
4. Ensure service has appropriate permissions

## Performance Issues

### Slow API Responses

**Symptoms**:
- API requests take a long time to complete
- Frontend feels sluggish

**Solutions**:
1. Implement caching for expensive operations
2. Optimize database queries
3. Use async operations where appropriate
4. Consider increasing server resources

### Memory Leaks

**Symptoms**:
- Service memory usage grows over time
- Performance degrades after running for a while

**Solutions**:
1. Ensure proper cleanup of browser instances:
   ```python
   try:
       # Browser operations
   finally:
       await browser.close()
   ```

2. Check for resource leaks in long-running processes
3. Implement periodic restart of services if needed
4. Monitor memory usage to identify memory leak patterns

## Common Error Messages and Solutions

| Error Message | Possible Cause | Solution |
|---------------|----------------|----------|
| `Address already in use` | Port conflict | Kill process using the port or change port |
| `'dict' object has no attribute 'llm'` | Missing LLM config | Include LLM config in requests |
| `Module not found` | Missing dependency | Reinstall dependencies |
| `CORS error` | CORS not configured | Add CORS middleware |
| `Playwright timeout` | Slow page load | Increase timeout settings |
| `Database connection error` | DB config issue | Check connection string |

## Getting Further Help

If you cannot resolve the issue using this guide:

1. Check the GitHub repository's Issues section for similar problems
2. Consult the project documentation
3. Reach out to the development team
4. Provide detailed information about your environment and the steps to reproduce the issue 