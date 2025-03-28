export interface TaskState {
  task_id: string;
  status: 'initializing' | 'running' | 'completed' | 'failed';
  start_time: string;
  current_step: number;
  total_steps: number;
  last_action?: string;
  error?: string;
  history: TaskHistoryItem[];
}

export interface TaskHistoryItem {
  step: number;
  action?: string;
  timestamp: string;
}

export interface TaskResponse {
  task_id: string;
  status: string;
  message: string;
}

export interface TaskRequest {
  task: string;
  max_steps?: number;
  config?: Record<string, any>;
} 