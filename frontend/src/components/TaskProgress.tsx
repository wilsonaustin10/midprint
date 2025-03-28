import React, { useEffect, useState } from 'react';
import { TaskState } from '@/types/browserUse';
import { BrowserUseService } from '@/lib/browserUseService';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TaskProgressProps {
  taskId: string;
  onComplete?: (state: TaskState) => void;
}

export function TaskProgress({ taskId, onComplete }: TaskProgressProps) {
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const browserUseService = BrowserUseService.getInstance();

    browserUseService.startPolling(
      taskId,
      (state) => {
        setTaskState(state);
        setError(null);
        
        if (state.status === 'completed' && onComplete) {
          onComplete(state);
        }
      },
      (error) => {
        setError(error.message);
      }
    );

    return () => {
      browserUseService.stopPolling(taskId);
    };
  }, [taskId, onComplete]);

  if (!taskState) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const progress = (taskState.current_step / taskState.total_steps) * 100;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          Task Progress
          <span className="ml-2 text-sm font-normal text-gray-500">
            {taskState.status}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {taskState.error && (
          <Alert variant="destructive">
            <AlertTitle>Task Error</AlertTitle>
            <AlertDescription>{taskState.error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="w-full" />
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Latest Actions</h4>
          <ScrollArea className="h-[200px] rounded-md border p-4">
            {taskState.history.map((item, index) => (
              <div
                key={index}
                className="mb-2 text-sm"
              >
                <span className="font-medium">Step {item.step}:</span>{' '}
                {item.action || 'Processing...'}
                <span className="text-gray-500 text-xs ml-2">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </ScrollArea>
        </div>

        {taskState.status === 'completed' && (
          <Alert>
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>Task completed successfully!</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
} 