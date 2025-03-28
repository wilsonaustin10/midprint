#!/usr/bin/env python3
import os
import sys
import pytest
import json
from datetime import datetime
from pathlib import Path

def setup_test_environment():
    """Setup the test environment and configuration."""
    # Ensure test directories exist
    Path("test_results").mkdir(exist_ok=True)
    Path("test_results/metrics").mkdir(exist_ok=True)
    Path("test_results/logs").mkdir(exist_ok=True)
    
    # Set test environment variables if not already set
    if not os.getenv("TEST_LINKEDIN_USERNAME"):
        print("WARNING: TEST_LINKEDIN_USERNAME not set. Tests requiring authentication will be skipped.")
    if not os.getenv("TEST_LINKEDIN_PASSWORD"):
        print("WARNING: TEST_LINKEDIN_PASSWORD not set. Tests requiring authentication will be skipped.")

def save_test_metrics(total, passed, failed, skipped, duration):
    """Save test metrics to a JSON file."""
    metrics = {
        "timestamp": datetime.now().isoformat(),
        "total_tests": total,
        "passed_tests": passed,
        "failed_tests": failed,
        "skipped_tests": skipped,
        "duration_seconds": duration
    }
    
    metrics_file = Path("test_results/metrics/test_metrics.json")
    with open(metrics_file, 'w') as f:
        json.dump(metrics, f, indent=2)

class TestMetricsPlugin:
    def __init__(self):
        self.total = 0
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.start_time = None
        self.duration = 0

    def pytest_sessionstart(self, session):
        self.start_time = datetime.now()

    def pytest_collection_modifyitems(self, items):
        self.total = len(items)

    def pytest_runtest_logreport(self, report):
        if report.when == 'call':
            if report.passed:
                self.passed += 1
            elif report.failed:
                self.failed += 1
        elif report.when == 'setup' and report.skipped:
            self.skipped += 1

    def pytest_sessionfinish(self, session):
        if self.start_time:
            self.duration = (datetime.now() - self.start_time).total_seconds()

def main():
    """Run the test suite with configuration."""
    # Setup environment
    setup_test_environment()
    
    # Configure pytest arguments
    pytest_args = [
        "--asyncio-mode=auto",
        "--verbose",
        "--capture=no",
        "--cov=app",
        "--cov-report=html:test_results/coverage",
        "--cov-report=term-missing",
        "--junit-xml=test_results/junit.xml",
        "tests/"
    ]
    
    # Create and register the metrics plugin
    metrics_plugin = TestMetricsPlugin()
    
    # Run tests
    print("\nRunning browser-use service test suite...")
    result = pytest.main(pytest_args, plugins=[metrics_plugin])
    
    # Save metrics using the collected data
    try:
        save_test_metrics(
            metrics_plugin.total,
            metrics_plugin.passed,
            metrics_plugin.failed,
            metrics_plugin.skipped,
            metrics_plugin.duration
        )
    except Exception as e:
        print(f"Warning: Could not save test metrics: {e}")
    
    return result

if __name__ == "__main__":
    sys.exit(main()) 