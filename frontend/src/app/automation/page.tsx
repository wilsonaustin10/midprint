'use client';

import { useState } from 'react';
import { TaskProgress } from '@/components/TaskProgress';
import { BrowserUseService } from '@/lib/browserUseService';

export default function AutomationPage() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startAutomation = async () => {
    try {
      setError(null);
      const browserUseService = BrowserUseService.getInstance();
      const result = await browserUseService.startTask(
        "Navigate to LinkedIn Sales Navigator and find potential leads in the software industry",
        50
      );
      setTaskId(result.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start automation');
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">LinkedIn Automation</h1>
      
      <div className="mb-4">
        <button
          onClick={startAutomation}
          disabled={!!taskId}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          Start Automation
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}

      {taskId && (
        <TaskProgress
          taskId={taskId}
          onComplete={() => {
            setTaskId(null);
          }}
        />
      )}
    </div>
  );
} 