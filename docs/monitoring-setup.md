# Monitoring Setup

This document outlines the monitoring setup for the Browser-Use Service and frontend application.

## Overview

Proper monitoring is essential for maintaining application health, performance, and reliability. This guide covers:

1. Application health monitoring
2. Performance metrics
3. Error logging and alerting
4. Resource utilization

## Health Checks

### Backend Service Health Monitoring

The Browser-Use Service exposes a `/health` endpoint that returns the current status of the service. Use this endpoint for:

- Load balancer health checks
- Container orchestration health probes (Kubernetes, ECS)
- External monitoring services

**Example health check configuration for AWS ECS**:

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -f http://localhost:8003/health || exit 1"],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

### Frontend Health Monitoring

For the Next.js frontend, implement a simple health check API endpoint:

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'healthy', service: 'frontend' });
}
```

## Metrics Collection

### Prometheus Integration

Set up Prometheus for collecting and storing metrics:

1. **Backend Service Instrumentation**:

   Install the Prometheus client for Python:
   ```bash
   pip install prometheus-client
   ```

   Add Prometheus middleware to the FastAPI app:
   ```python
   from prometheus_client import Counter, Histogram
   from prometheus_fastapi_instrumentator import Instrumentator

   # Initialize in app/main.py
   Instrumentator().instrument(app).expose(app)
   ```

2. **Metrics to Monitor**:

   - Request count by endpoint
   - Request duration
   - Error rate
   - Task success/failure rate
   - Browser task execution time
   - Active sessions

### Grafana Dashboards

Set up Grafana dashboards to visualize metrics:

1. Connect Grafana to Prometheus as a data source
2. Create dashboards for:
   - API performance
   - Error rates
   - Resource utilization
   - Business metrics (successful tasks, etc.)

**Example Dashboard Panels**:
- Request rate by endpoint
- 95th percentile response time
- Error rate
- Active sessions over time
- Task completion rate
- CPU/Memory usage

## Log Aggregation

### Centralized Logging

Implement centralized logging using ELK Stack (Elasticsearch, Logstash, Kibana) or a cloud-based solution:

1. **Backend Logging Configuration**:

   ```python
   import logging
   from loguru import logger

   # Configure loguru logger
   logger.configure(
       handlers=[
           {"sink": "logs/app.log", "rotation": "10 MB", "level": "INFO"},
           {"sink": sys.stdout, "level": "INFO"},
       ]
   )
   ```

2. **Frontend Logging**:

   Implement client-side error logging that sends errors to your backend:
   ```typescript
   // src/lib/errorLogging.ts
   export function logClientError(error: Error, context: any = {}) {
     fetch('/api/log-error', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         message: error.message,
         stack: error.stack,
         context,
         timestamp: new Date().toISOString(),
       }),
     }).catch(console.error);
   }
   ```

### Log Shipping

Configure log shipping to send logs to a centralized location:

- Use Filebeat for shipping logs to Elasticsearch
- Configure AWS CloudWatch Logs for AWS deployments
- Use Google Cloud Logging for GCP deployments

## Alerting

### Alert Configuration

Set up alerts for critical issues:

1. **Service-level Alerts**:
   - Service unavailability
   - High error rates (> 5%)
   - Slow response times (p95 > 1s)
   - Task failure rate > 10%

2. **Infrastructure Alerts**:
   - High CPU usage (> 80%)
   - High memory usage (> 80%)
   - Disk space running low (< 20% free)
   - Instance/container restarts

### Alert Channels

Configure multiple alert channels:

- Email notifications
- Slack/Teams integration
- PagerDuty for on-call rotations
- SMS for critical alerts

## Uptime Monitoring

Implement external uptime monitoring:

1. **Uptime Checks**:
   - Set up ping checks from multiple regions
   - Regular health endpoint checks
   - Synthetic transactions that simulate user flows

2. **Status Page**:
   - Implement a status page showing service health
   - Display planned maintenance windows
   - Provide incident history

## Resource Monitoring

Monitor system resources:

1. **Server Metrics**:
   - CPU utilization
   - Memory usage
   - Disk I/O
   - Network traffic

2. **Database Metrics**:
   - Connection pool usage
   - Query performance
   - Transaction rate
   - Storage usage

## Tracing

Implement distributed tracing for complex requests:

1. **OpenTelemetry Integration**:
   - Install OpenTelemetry:
     ```bash
     pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-jaeger
     ```
   - Instrument key components

2. **Trace Key Operations**:
   - API requests
   - Database queries
   - External service calls
   - Task execution steps

## Monitoring Tools and Services

Recommended monitoring tools:

- **Self-hosted**: Prometheus + Grafana, ELK Stack, Jaeger
- **Cloud-based**: 
  - AWS: CloudWatch, X-Ray
  - GCP: Cloud Monitoring, Cloud Trace
  - Azure: Application Insights
- **SaaS**: Datadog, New Relic, Dynatrace

## Dashboard Setup

Create operational dashboards for different stakeholders:

1. **Engineering Dashboard**:
   - Detailed technical metrics
   - Error rates and logs
   - Deployment status

2. **Executive Dashboard**:
   - Service uptime
   - User activity metrics
   - Task success rates
   - Key business metrics 