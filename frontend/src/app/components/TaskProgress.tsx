'use client'

import React from 'react';
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type TaskProgressProps = {
  status: string | null;
  currentStep: number | null;
  totalSteps: number | null;
  lastAction?: string | null;
  error?: string | null;
}

export default function TaskProgress({ 
    status, 
    currentStep, 
    totalSteps, 
    lastAction, 
    error 
}: TaskProgressProps) {
  
  if (!status || currentStep === null || totalSteps === null) {
    // Don't render anything if essential info is missing
    return null; 
  }

  // Calculate progress percentage
  const progressPercentage = totalSteps > 0
    ? Math.min(100, (currentStep / totalSteps) * 100)
    : 0

  // Format status for display
  const displayStatus = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle>Task Progress</CardTitle>
        <CardDescription>
          Status: {displayStatus}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress value={progressPercentage} className="mb-2" />
        <div className="text-sm text-muted-foreground">
          Step {currentStep} of {totalSteps || '?'}
        </div>
        {lastAction && (
          <div className="mt-2 text-sm">
            <span className="font-semibold">Last action:</span> {lastAction}
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