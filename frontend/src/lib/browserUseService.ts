import { TaskState } from '@/types/browserUse';

const BROWSER_USE_API = process.env.NEXT_PUBLIC_BROWSER_USE_API || 'http://localhost:8003';

export class BrowserUseService {
  private static instance: BrowserUseService;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {}

  static getInstance(): BrowserUseService {
    if (!BrowserUseService.instance) {
      BrowserUseService.instance = new BrowserUseService();
    }
    return BrowserUseService.instance;
  }

  async startTask(task: string, maxSteps: number = 50): Promise<{ taskId: string }> {
    const response = await fetch(`${BROWSER_USE_API}/run-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task,
        max_steps: maxSteps,
        config: {
          llm: {
            provider: 'openai',
            model: 'gpt-4'
          }
        },
        browser_info: {
          browser_type: 'chromium',
          headless: true
        }
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to start task');
    }

    return response.json();
  }

  async getTaskState(taskId: string): Promise<TaskState> {
    const response = await fetch(`${BROWSER_USE_API}/task/${taskId}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get task state');
    }

    return response.json();
  }

  startPolling(taskId: string, onUpdate: (state: TaskState) => void, onError: (error: Error) => void) {
    // Clear any existing polling for this task
    this.stopPolling(taskId);

    const poll = async () => {
      try {
        const state = await this.getTaskState(taskId);
        onUpdate(state);

        // Stop polling if task is completed or failed
        if (state.status === 'completed' || state.status === 'failed') {
          this.stopPolling(taskId);
        }
      } catch (error) {
        onError(error as Error);
        this.stopPolling(taskId);
      }
    };

    // Poll every 1 second
    const interval = setInterval(poll, 1000);
    this.pollingIntervals.set(taskId, interval);

    // Initial poll
    poll();
  }

  stopPolling(taskId: string) {
    const interval = this.pollingIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(taskId);
    }
  }
} 