'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import ChatMessage from "./ChatMessage"
import { Button } from "@/components/ui/button"
import { Message } from "../../types/messages"
import { Textarea } from "@/components/ui/textarea"
import { processStream } from "@/lib/llm-text"
import { performAction, navigateTo, runAgentTask, ActionResult } from "@/app/actions/browser"
import { BrowserActions, SERVICE_BASE_URL, ENDPOINTS } from "@/app/api/browser-service/actions"
import TaskProgress from "./TaskProgress"

type P = {
    initialMessages: Message[];
    sessionId: string;
    updateBrowserState: (result: Partial<ActionResult>) => void;
    addLog: (message: string) => void;
}

// Define the expected structure for the 'completed' event data
interface TaskCompletionData {
  status: string; // Should be 'completed'
  history: any[]; // Define more specifically if needed
  result: string | null;
}

interface TaskFailureData {
  status: string; // Should be 'failed'
  error: string;
}

interface BrowserUpdateData {
  url?: string;
  pageTitle?: string;
  screenshot?: string;
  formElements?: any[]; // Define more specifically if needed
  historyState?: any; // Define more specifically if needed
  current_step?: number; // Added optional step info
}

interface HistoryUpdateData {
    type: string; // Should be 'history_update'
    current_step: number;
    total_steps: number;
    message: string;
    // Potentially add screenshot/url here if they can come with history_update
    screenshot?: string;
    url?: string;
}

interface AgentStepData {
    type: string; // Should be 'agent_step'
    current_step: number;
    total_steps: number;
    message: string;
    // Potentially add screenshot/url here if they can come with agent_step
    screenshot?: string;
    url?: string;
}

// Define specific types for event data
interface TaskStatusUpdate {
    status: string;
    message?: string;
    current_step?: number; // Optional step info
    total_steps?: number;  // Optional step info
}

interface LogData {
    message: string;
}

export default function ChatBox({ initialMessages, sessionId, updateBrowserState, addLog }: P) {
    const [messages, setMessages] = useState<Message[]>(initialMessages)
    const [inputMessage, setInputMessage] = useState<string>("")
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
    const [taskStatus, setTaskStatus] = useState<string>('idle')
    const [taskError, setTaskError] = useState<string | null>(null)
    const [taskProgressInfo, setTaskProgressInfo] = useState<{ 
        current_step: number | null; 
        total_steps: number | null; 
        last_action?: string | null 
    }>({ current_step: null, total_steps: null, last_action: null });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentResponseRef = useRef<string>("");
    const eventSourceRef = useRef<EventSource | null>(null);
    const closedCleanlyRef = useRef<boolean>(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeTaskIdRef = useRef<string | null>(null);
    const isUnmountingRef = useRef(false);
    
    const memoizedAddLog = useCallback((log: string) => {
        addLog(log);
    }, [addLog]);

    // Keep activeTaskIdRef synced with activeTaskId state
    useEffect(() => {
        activeTaskIdRef.current = activeTaskId;
    }, [activeTaskId]);

    // Helper function to close EventSource
    const closeEventSource = useCallback(() => {
        const taskId = activeTaskIdRef.current;
        if (eventSourceRef.current) {
            console.log(`[SSE closeEventSource] Closing EventSource explicitly for task ID (ref): ${taskId ?? 'N/A'}. Current activeTaskId state: ${activeTaskId}`);
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        } else {
            console.log(`[SSE closeEventSource] Attempted to close, but eventSourceRef.current was already null.`);
        }
        closedCleanlyRef.current = false;
        setIsLoading(false);
        if (taskStatus !== 'completed' && taskStatus !== 'failed') {
        }
    }, [activeTaskId]);

    // Memoize event handlers to prevent recreating them on every render
    const eventHandlers = useMemo(() => ({
      onOpen: () => {
        const taskId = activeTaskIdRef.current;
        console.log(`[SSE onOpen] Connection opened for task ID (ref): ${taskId ?? 'N/A'}. ReadyState: ${eventSourceRef.current?.readyState}`);
        addLog('SSE connection established.');
        setTaskStatus('running');
        setTaskError(null);
      },
      onError: (error: Event) => {
        const taskId = activeTaskIdRef.current;
        console.error(`[SSE onError] EventSource failed for task ID (ref): ${taskId ?? 'N/A'}`, error);
        if (eventSourceRef.current) {
            console.error(`[SSE onError] ReadyState: ${eventSourceRef.current.readyState}`);
            if (eventSourceRef.current.readyState === EventSource.CLOSED) {
                setTaskError(`Connection closed unexpectedly for task ${taskId ?? 'N/A'}.`);
            } else {
                setTaskError(`Connection error for task ${taskId ?? 'N/A'}.`);
            }
            closeEventSource();
        } else {
            setTaskError(`Connection error for task ${taskId ?? 'N/A'} (EventSource ref null).`);
        }
      },
      status: (data: TaskStatusUpdate) => {
        addLog(`Task Status: ${data.status} - ${data.message || ''}`);
        setTaskStatus(data.status);
      },
      log: (data: LogData) => {
        addLog(`Agent Log: ${data.message}`);
      },
      agent_step: (data: AgentStepData) => {
        addLog(`Agent Step ${data.current_step}/${data.total_steps}: ${data.message || ''}`);
        setTaskStatus("running");
        setTaskProgressInfo({
            current_step: data.current_step,
            total_steps: data.total_steps,
            last_action: data.message || `Executing step ${data.current_step}`
        });
        if (data.screenshot) {
            updateBrowserState({ screenshot: data.screenshot });
        }
        if (data.url) {
            updateBrowserState({ url: data.url });
        }
      },
      history_update: (data: HistoryUpdateData) => {
        addLog(`Agent History Update (Step ${data.current_step}): ${data.message}`);
        setTaskStatus("running");
        setTaskProgressInfo(prev => ({
            ...prev,
            current_step: data.current_step,
            last_action: data.message
        }));
        if (data.screenshot) {
            updateBrowserState({ screenshot: data.screenshot });
        }
        if (data.url) {
            updateBrowserState({ url: data.url });
        }
      },
      browser_update: (data: { type: string; data: BrowserUpdateData }) => {
        const taskId = activeTaskIdRef.current;
        addLog(`Browser Update Received (Task: ${taskId ?? 'N/A'}, Step ${data.data?.current_step ?? 'N/A'})`);
        if (data.data) {
          console.log('[ChatBox browser_update] Calling updateBrowserState with:', data.data);
          updateBrowserState(data.data);
        }
      },
      completed: (data: TaskCompletionData) => {
        closedCleanlyRef.current = true;
        console.log('[SSE] Task completed event');
        setTaskStatus('completed');
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: data.result || 'Task finished.' },
        ]);
        closeEventSource();
      },
      failed: (data: TaskFailureData) => {
        closedCleanlyRef.current = true;
        console.error('[SSE] Task failed event:', data.error);
        setTaskStatus('failed');
        setTaskError(data.error || 'Task failed due to an unknown error.');
        setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: 'assistant', content: `Task failed: ${data.error || 'Unknown error'}` },
        ]);
        closeEventSource();
      },
      debug: (data: any) => {
          console.log("[SSE Debug]", data);
      }
    }), [addLog, updateBrowserState, setTaskStatus, setTaskError, setActiveTaskId]);

    const wrappedHandler = useCallback((event: MessageEvent) => {
        try {
            const parsedData = JSON.parse(event.data);
            const eventType = event.type === 'message' ? parsedData.type : event.type;

            if (eventType && eventHandlers[eventType as keyof typeof eventHandlers]) {
                (eventHandlers[eventType as keyof typeof eventHandlers] as (data: any) => void)(parsedData);
            } else if (event.type === 'message' && !parsedData.type) {
                 console.warn("[SSE Wrapped Handler] Received 'message' event without a 'type' field in data:", parsedData);
            } else if (event.type !== 'message') {
                console.log(`[SSE Wrapped Handler] Received standard event: ${event.type}`);
            } else {
                console.warn(`[SSE Wrapped Handler] No handler found for event type: ${eventType}`);
            }
        } catch (e) {
            console.error('[SSE Wrapped Handler] Error parsing JSON or handling message:', e, 'Raw data:', event.data);
             setTaskError('Error processing message from server.');
        }
    }, [eventHandlers]);

    const setupSSE = useCallback((taskId: string) => {
        if (!taskId) {
            console.error("[SSE setupSSE] Attempted setup with null/empty taskId.");
            return;
        }
        console.log(`[SSE setupSSE] Starting setup for task: ${taskId}`);
        closeEventSource();

        const url = `${SERVICE_BASE_URL}${ENDPOINTS.TASK_STATUS}/${taskId}/stream`;
        console.log(`[SSE setupSSE] Creating EventSource with URL: ${url}`);
        const es = new EventSource(url);
        console.log(`[SSE setupSSE] EventSource object created for task: ${taskId}. Initial readyState: ${es.readyState}`);
        eventSourceRef.current = es;

        es.onopen = eventHandlers.onOpen;
        es.onerror = eventHandlers.onError;

        es.addEventListener('message', wrappedHandler);
        Object.keys(eventHandlers).forEach(eventType => {
            if (eventType !== 'onOpen' && eventType !== 'onError') {
                es.addEventListener(eventType, wrappedHandler);
            }
        });
         console.log(`[SSE setupSSE] Event listeners attached for task: ${taskId}`);

    }, [closeEventSource, eventHandlers, wrappedHandler]);

    // Add this ref before the useEffect
    const isInitialMount = useRef(true);

    // Replace the existing useEffect
    useEffect(() => {
        console.log(`[SSE useEffect] Running effect. activeTaskId: ${activeTaskId}`);

        if (isInitialMount.current && !activeTaskId) {
            isInitialMount.current = false;
            return;
        }

        isUnmountingRef.current = false;

        if (activeTaskId) {
            setupSSE(activeTaskId);
        } else {
            console.log("[SSE useEffect] activeTaskId is null, ensuring connection is closed.");
            closeEventSource();
        }

        return () => {
            console.log(`[SSE useEffect Cleanup] Running cleanup for task ID (state): ${activeTaskId}. EventSource ref exists: ${!!eventSourceRef.current}`);
            
            if (eventSourceRef.current?.url.split('/').pop() === activeTaskId && !isUnmountingRef.current) {
                console.log("[SSE useEffect Cleanup] Skipping cleanup as task ID hasn't changed and component isn't unmounting");
                return;
            }

            if (!closedCleanlyRef.current && eventSourceRef.current) {
                console.warn("[SSE useEffect Cleanup] Closing EventSource due to task change or unmount");
            } else if (closedCleanlyRef.current) {
                console.log("[SSE useEffect Cleanup] Cleanup running, closure was marked as clean (completed/failed)");
            }

            closeEventSource();
        };
    }, [activeTaskId, setupSSE, closeEventSource]);

    // Add a new useEffect for component unmount detection
    useEffect(() => {
        return () => {
            isUnmountingRef.current = true;
        };
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    const handleSendMessage = async (e: React.FormEvent<HTMLButtonElement>) => {
        e.preventDefault()
        if (!inputMessage.trim() || isLoading) return;
        setMessages(prevMessages => [...prevMessages, { content: inputMessage, role: "user" }])
        setInputMessage("")
        setIsLoading(true);

        currentResponseRef.current = "";
        try {
            setMessages(prevMessages => [...prevMessages, { content: "", role: "assistant" }])
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(
                    {
                        messages,
                        inputMessage,
                        sessionId
                    }
                )
            })
            if (!response.ok) {
                console.error("Failed to generate chat response")
                setMessages(prevMessages => {
                    const newMessages = [...prevMessages];
                    newMessages[newMessages.length - 1] = { content: "Error: Could not get chat response.", role: "assistant" };
                    return newMessages;
                });
                setIsLoading(false);
                return;
            }

            await processStream(response, currentResponseRef, setMessages)
        } catch (error) { 
            console.error("Error generating chat response:", error)
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                newMessages[newMessages.length - 1] = { content: `Error: ${error instanceof Error ? error.message : 'Chat request failed'}`, role: "assistant" };
                return newMessages;
            });
        } finally {
            setIsLoading(false)
        }
    }

    const handleComputerUse = async (e: React.FormEvent<HTMLButtonElement>) => {
        e.preventDefault()
        if (!inputMessage.trim() || isLoading) return;
        const userInput = inputMessage.trim();
        setMessages(prevMessages => [...prevMessages, { content: userInput, role: "user" }])
        setInputMessage("")
        setIsLoading(true);
        setActiveTaskId(null);
        setTaskStatus('idle');
        setTaskError(null);
        setTaskProgressInfo({ current_step: null, total_steps: null, last_action: null });

        currentResponseRef.current = "";
        try {
            setMessages(prevMessages => [...prevMessages, { content: "Processing your action...", role: "assistant" }])
            
            let result: Partial<ActionResult> | null = null;
            
            if (userInput.startsWith('http://') || userInput.startsWith('https://') || 
                userInput.match(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/)) {
                const url = userInput.startsWith('http') ? userInput : `https://${userInput}`;
                addLog(`Navigating to URL: ${url}`);
                result = await navigateTo(url, sessionId);
                
                if (result.success) {
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { 
                            content: `Successfully navigated to: ${url}`,
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                    updateBrowserState(result);
                } else {
                    const errorMsg = `Failed to navigate to: ${url}. ${result.error || ''}`;
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { content: errorMsg, role: "assistant" };
                        return newMessages;
                    });
                     addLog(errorMsg);
                }
                setIsLoading(false);
            } else if (userInput.toLowerCase().startsWith('search:') || userInput.toLowerCase().startsWith('search ')) {
                 const searchQuery = userInput.replace(/^search:?\s*/i, '').trim();
                 addLog(`Attempting search for: ${searchQuery}`);
                 
                 result = await performAction(
                     BrowserActions.FILL_INPUT, 
                     'input[type="text"], input[type="search"], textarea', 
                     searchQuery,
                     sessionId
                 );
                 
                 if (result.success) {
                     const submitResult = await performAction(
                         BrowserActions.PRESS,
                         'input[type="text"], input[type="search"], textarea',
                         'Enter',
                         sessionId
                     );
                     
                     result = submitResult;
                     
                     if (result.success) {
                         const successMsg = `Searched for: ${searchQuery}`;
                         setMessages(prev => {
                             const newMessages = [...prev];
                             newMessages[newMessages.length - 1] = { content: successMsg, role: "assistant" };
                             return newMessages;
                         });
                         addLog(successMsg);
                         updateBrowserState(result);
                     } else {
                         const errorMsg = `Filled search input, but failed to submit (press Enter). ${result.error || ''}`;
                         setMessages(prev => {
                            const newMessages = [...prev];
                            newMessages[newMessages.length - 1] = { content: errorMsg, role: "assistant" };
                            return newMessages;
                        });
                        addLog(errorMsg);
                     }
                 } else {
                     const errorMsg = `Could not find a search input to fill for: ${searchQuery}. ${result.error || ''}`;
                     setMessages(prev => {
                         const newMessages = [...prev];
                         newMessages[newMessages.length - 1] = { content: errorMsg, role: "assistant" };
                         return newMessages;
                     });
                     addLog(errorMsg);
                 }
                 setIsLoading(false);
            } else {
                setMessages(prevMessages => {
                    const newMessages = [...prevMessages];
                    newMessages[newMessages.length - 1] = { 
                        content: `Starting agent task: "${userInput}"...`, 
                        role: "assistant" 
                    };
                    return newMessages;
                });
                addLog(`Requesting agent task: "${userInput}"`);
                
                const response = await fetch(`${SERVICE_BASE_URL}${ENDPOINTS.RUN_AGENT}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        task: userInput,
                        max_steps: 3,
                        config: {
                            llm: {
                                provider: 'openai',
                                model: 'gpt-4o'
                            }
                        },
                        browser_info: {
                            headless: true
                        }
                    }),
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                    throw new Error(`Failed to start agent task: ${errorData.detail || response.statusText}`);
                }
                
                const data = await response.json();
                addLog(`Agent task scheduled with ID: ${data.task_id}`);
                
                setActiveTaskId(data.task_id);
                setTaskStatus('scheduled');
                setTaskError(null);
                setTaskProgressInfo({ current_step: 0, total_steps: 30, last_action: 'Task scheduled' }); 
                
                return;
            }
            
        } catch (error) { 
            console.error("Error performing browser action/task:", error);
            const errorMsg = `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`;
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                    newMessages[newMessages.length - 1].content = errorMsg;
                } else {
                    newMessages.push({ content: errorMsg, role: "assistant" });
                }
                return newMessages;
            });
            addLog(`Error caught: ${errorMsg}`);
            setIsLoading(false);
            setActiveTaskId(null);
            setTaskStatus('error');
            setTaskError(errorMsg);
            setTaskProgressInfo({ current_step: null, total_steps: null, last_action: null });
        } finally {
            if (!activeTaskId) { 
                setIsLoading(false);
            }
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div 
                className="flex-1 overflow-y-auto flex flex-col gap-2 pb-2" 
                style={{ scrollBehavior: "smooth", maxHeight: isLoading && activeTaskId ? "calc(100% - 150px)" : "calc(100% - 70px)" }}
            >
                {messages.map((message, index) => (
                    <ChatMessage key={index} {...message} />
                ))}
                <div ref={messagesEndRef} />
            </div>
            
            {isLoading && activeTaskId && (
                <div className="mt-auto pt-2 mb-2 border-t">
                    <TaskProgress 
                        status={taskStatus}
                        currentStep={taskProgressInfo.current_step}
                        totalSteps={taskProgressInfo.total_steps}
                        lastAction={taskProgressInfo.last_action}
                        error={taskError}
                    />
                </div>
            )}
            
            <Textarea
                rows={1}
                value={inputMessage}
                className="cursor-pointer mt-auto"
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault(); 
                        const isCommandLike = inputMessage.trim().split(' ').length > 1 || inputMessage.includes('http') || inputMessage.includes('.') || inputMessage.toLowerCase().startsWith('search');
                        if (isCommandLike) {
                             handleComputerUse(e as any);
                        } else {
                             handleSendMessage(e as any);
                        }
                    }
                }}
                placeholder="Type a message to chat, or a command for the browser agent" 
            />
            <div className="flex gap-2 mt-2">
                <Button type="submit" onClick={handleSendMessage} disabled={isLoading || !inputMessage.trim()}>Chat with AI</Button>
                <Button type="submit" onClick={handleComputerUse} disabled={isLoading || !inputMessage.trim()}>Browser Action</Button>
            </div>
        </div>
    )
}
