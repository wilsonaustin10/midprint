'use client'

import { useEffect, useState } from 'react'
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SERVICE_BASE_URL, ENDPOINTS } from '../api/browser-service/actions'

type TaskProgressProps = {
  taskId: string | null
  onComplete?: () => void
}

export default function TaskProgress({ taskId, onComplete }: TaskProgressProps) {
  const [taskStatus, setTaskStatus] = useState<{
    status: string
    current_step: number
    total_steps: number
    last_action?: string
    history: any[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!taskId) return

    // Set up polling
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.TASK_STATUS}/${taskId}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch task status: ${response.statusText}`)
        }
        
        const data = await response.json()
        setTaskStatus(data)
        
        // If task is completed or failed, stop polling
        if (data.status === 'completed' || data.status === 'failed') {
          if (pollingInterval) {
            clearInterval(pollingInterval)
            setPollingInterval(null)
          }
          
          // Call onComplete callback if provided
          if (onComplete) {
            onComplete()
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error fetching task status')
        // Stop polling on error
        if (pollingInterval) {
          clearInterval(pollingInterval)
          setPollingInterval(null)
        }
      }
    }, 1000)
    
    setPollingInterval(intervalId)
    
    // Cleanup on unmount
    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [taskId])

  if (!taskId || !taskStatus) {
    return null
  }

  // Calculate progress percentage
  const progressPercentage = taskStatus.total_steps > 0
    ? Math.min(100, (taskStatus.current_step / taskStatus.total_steps) * 100)
    : 0

  // Get the latest action from history if available
  const latestAction = taskStatus.history.length > 0
    ? taskStatus.history[taskStatus.history.length - 1]
    : null

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle>Task Progress</CardTitle>
        <CardDescription>
          Status: {taskStatus.status.charAt(0).toUpperCase() + taskStatus.status.slice(1)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress value={progressPercentage} className="mb-2" />
        <div className="text-sm text-muted-foreground">
          Step {taskStatus.current_step} of {taskStatus.total_steps || '?'}
        </div>
        {latestAction && (
          <div className="mt-2 text-sm">
            <span className="font-semibold">Last action:</span> {latestAction.action}
          </div>
        )}
        {error && (
          <div className="mt-2 text-sm text-red-500">
            Error: {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
} 