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
    
    const memoizedAddLog = useCallback((log: string) => {
        addLog(log);
    }, [addLog]);

    // Helper function to close EventSource
    const closeEventSource = () => {
        if (eventSourceRef.current) {
            // Add log with task ID context if possible
            const closingTaskId = eventSourceRef.current.url.split('/').pop(); // Attempt to get task ID from URL
            console.log(`[SSE closeEventSource] Closing EventSource explicitly for task ID (from URL): ${closingTaskId}. Current activeTaskId state: ${activeTaskId}`);
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        } else {
             console.log("[SSE closeEventSource] Attempted to close, but eventSourceRef.current was already null.");
        }
        closedCleanlyRef.current = false; // Reset flag after closure
        // COMMENTED OUT: Let the component lifecycle manage activeTaskId resetting
        // setActiveTaskId(null); 
        setIsLoading(false);
        // Optionally reset progress info based on task status if needed
        // If the status isn't completed/failed, maybe reset to idle/error?
        if (taskStatus !== 'completed' && taskStatus !== 'failed') {
             // Resetting progress might be needed if closed unexpectedly
             // setTaskProgressInfo({ current_step: null, total_steps: null, last_action: null });
             // Consider setting taskStatus to 'idle' or 'error' here if the closure wasn't clean
        }
    };

    // Memoize event handlers to prevent recreating them on every render
    const eventHandlers = useMemo(() => ({
      onOpen: () => {
        console.log(`[SSE onOpen] Connection opened for task ID: ${activeTaskId}. ReadyState: ${eventSourceRef.current?.readyState}`);
        addLog('SSE connection established.');
        setTaskStatus('running'); // Assume running once opened
        setTaskError(null);
      },
      onError: (error: Event) => { // Use Event type for standard errors
        const es = eventSourceRef.current;
        const errorTaskId = es ? es.url.split('/').pop() : 'N/A';
        const currentReadyState = es ? es.readyState : 'N/A';

        console.error(`[SSE onError] Error event for task ID (from URL): ${errorTaskId}. Current activeTaskId state: ${activeTaskId}. ReadyState: ${currentReadyState}`, error);

        if (!es) {
            console.error("[SSE onError] EventSource reference is null, cannot determine state.");
            // Potentially set error state here if appropriate
            return;
        };

        if (closedCleanlyRef.current) {
          console.log("[SSE onError] onError detected, but closure was marked as expected (completed/failed). Ignoring error event.");
          // Explicitly do nothing and don't close again
          return;
        }

        // Check specific states
        if (currentReadyState === EventSource.CONNECTING) {
            console.warn("[SSE onError] State: CONNECTING (0). Browser might be attempting reconnect after server closed stream OR initial connection failed.");
            setTaskError("Connection lost or failed, attempting to reconnect...");
        } else if (currentReadyState === EventSource.CLOSED) {
            console.log("[SSE onError] State: CLOSED (2). Connection closed.");
            // Differentiate between clean closure and unexpected closure
            if (taskStatus !== 'completed' && taskStatus !== 'failed' && !closedCleanlyRef.current) {
                 console.warn("[SSE onError] State: CLOSED, but task not marked completed/failed and not closed cleanly. Setting error state.");
                 setTaskStatus('error');
                 setTaskError('SSE connection closed unexpectedly.');
                 setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Connection closed unexpectedly.' }]);
            } else {
                console.log("[SSE onError] State: CLOSED, but task was completed/failed or closed cleanly. Likely expected closure.");
            }
        } else if (currentReadyState === EventSource.OPEN) {
           console.error("[SSE onError] State: OPEN (1). Error occurred while connection was open. Treating as error.", error);
           setTaskStatus('error');
           setTaskError('SSE connection error while open.');
           setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'SSE connection error.' }]);
        } else {
           console.error("[SSE onError] Unknown ReadyState:", currentReadyState, "Treating as error.", error);
           setTaskStatus('error');
           setTaskError('SSE connection error (unknown state).');
           setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'SSE connection error (unknown state).' }]);
        }
        
        // Close source on *any* error if not already closed cleanly, to prevent loops
        if (!closedCleanlyRef.current && es.readyState !== EventSource.CLOSED) {
             console.log("[SSE onError] Closing EventSource due to error.");
             closeEventSource();
        } else if (es.readyState === EventSource.CLOSED) {
             console.log("[SSE onError] EventSource already closed, ensuring ref is null.");
             eventSourceRef.current = null; // Ensure ref is cleared if onError fires after close
        }
      },
      // Specific event type handlers (mapped from data.type usually)
      status: (data: TaskStatusUpdate) => {
        addLog(`Task Status: ${data.status} - ${data.message || ''}`);
        setTaskStatus(data.status);
        // Potentially update progress info based on status message if needed
        // if (data.message) {
        //     setTaskProgressInfo(prev => ({ ...prev, last_action: data.message }));
        // }
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
        // Check if step data includes browser state
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
            ...prev, // Keep total_steps from agent_step if available
            current_step: data.current_step,
            last_action: data.message // Update last action with history message
        }));
         // Check if history data includes browser state
        if (data.screenshot) {
            updateBrowserState({ screenshot: data.screenshot });
        }
        if (data.url) {
            updateBrowserState({ url: data.url });
        }
      },
      browser_update: (data: { type: string; data: BrowserUpdateData }) => {
        addLog(`Browser Update Received (Step ${data.data?.current_step ?? 'N/A'})`);
        if (data.data) {
          console.log('[ChatBox browser_update] Calling updateBrowserState with:', data.data);
          updateBrowserState(data.data);
        }
      },
      completed: (data: TaskCompletionData) => {
        closedCleanlyRef.current = true; // Set flag immediately
        console.log('[SSE] Task completed event');
        setTaskStatus('completed');
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: data.result || 'Task finished.' },
        ]);
        closeEventSource(); // Use the helper function
      },
      failed: (data: TaskFailureData) => {
        closedCleanlyRef.current = true; // Set flag immediately
        console.error('[SSE] Task failed event:', data.error);
        setTaskStatus('failed'); // Use 'failed' status for failed tasks
        setTaskError(data.error || 'Task failed due to an unknown error.');
        setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: 'assistant', content: `Task failed: ${data.error || 'Unknown error'}` },
        ]);
        closeEventSource(); // Use the helper function
      },
      // Add other potential handlers if needed, e.g., debug
      debug: (data: any) => {
          console.log("[SSE Debug]", data);
      }
    // We don't need onMessage here as wrappedHandler handles 'message' events
    // Only include stable dependencies: updateBrowserState. 
    // addLog and taskStatus are likely stable or their current value is accessible via closure.
    }), [addLog, updateBrowserState]); // REMOVED setTaskStatus from dependencies

    const setupSSE = () => {
      if (!activeTaskId) {
        console.log("[SSE setupSSE] Aborted: activeTaskId is null or empty.");
        return;
      }
      if (eventSourceRef.current) {
         console.log(`[SSE setupSSE] Aborted: EventSource already exists for task ID (from URL): ${eventSourceRef.current.url.split('/').pop()}. Current activeTaskId state: ${activeTaskId}`);
        return;
      }

      console.log(`[SSE setupSSE] Starting setup for task: ${activeTaskId}`);
      setTaskStatus('initializing');
      setTaskError(null);
      // Clear previous non-user messages that indicate problems or are task-specific outputs
      setMessages((prev) => prev.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.content.startsWith('Task failed') && !m.content.startsWith('Connection') && !m.content.startsWith('SSE connection'))));
      setTaskProgressInfo({ current_step: 0, total_steps: null, last_action: 'Task starting...' });
      closedCleanlyRef.current = false; // Explicitly reset flag here

      try {
        const url = `${SERVICE_BASE_URL}${ENDPOINTS.TASK_STATUS}/${activeTaskId}/stream`;
        console.log(`[SSE setupSSE] Creating EventSource with URL: ${url}`);
        const es = new EventSource(url);
        console.log(`[SSE setupSSE] EventSource object created for task: ${activeTaskId}. Initial readyState: ${es.readyState}`);
        eventSourceRef.current = es;

        // Setup standard listeners
        es.onopen = eventHandlers.onOpen;
        es.onerror = eventHandlers.onError;

        // Setup custom message listener
        const wrappedHandler = (event: MessageEvent) => {
            // console.log('[SSE Raw Message]', event.data); // Optional: log raw data
            try {
                const parsedData = JSON.parse(event.data);
                const eventType = event.type === 'message' ? parsedData.type : event.type; // Determine event type correctly

                // console.log(`[SSE Wrapped Handler] Received event type: ${eventType} for task ID: ${activeTaskId}`, parsedData); // Log parsed data

                // Dynamically call the correct handler based on the event type
                if (eventType && eventHandlers[eventType as keyof typeof eventHandlers]) {
                    // Assuming eventHandlers contains functions keyed by event type strings
                    (eventHandlers[eventType as keyof typeof eventHandlers] as (data: any) => void)(parsedData);
                } else if (event.type === 'message' && !parsedData.type) {
                     console.warn("[SSE Wrapped Handler] Received 'message' event without a 'type' field in data:", parsedData);
                } else if (event.type !== 'message') {
                    console.log(`[SSE Wrapped Handler] Received standard event: ${event.type}`); // e.g., 'open', 'error' - handled by direct listeners
                } else {
                    console.warn(`[SSE Wrapped Handler] No handler found for event type: ${eventType}`);
                }
            } catch (e) {
                console.error('[SSE Wrapped Handler] Error parsing JSON or handling message:', e, 'Raw data:', event.data);
                 setTaskError('Error processing message from server.');
                 // Consider closing connection on parse error if it's persistent
                 // closeEventSource(); 
            }
        };

        // Add listener for general 'message' events (if backend sends events without specific event names)
        // And add listeners for specific event names if the backend uses them
        es.addEventListener('message', wrappedHandler); // Handles events with `event: message` or no `event` field
        // Add specific listeners if backend sends named events like `event: status`, `event: log` etc.
        Object.keys(eventHandlers).forEach(eventType => {
            if (eventType !== 'onOpen' && eventType !== 'onError') { // Standard handlers are set directly
                es.addEventListener(eventType, wrappedHandler);
            }
        });
         console.log(`[SSE setupSSE] Event listeners attached for task: ${activeTaskId}`);

      } catch (error) {
        console.error(`[SSE setupSSE] Error creating EventSource for task ${activeTaskId}:`, error);
        setTaskStatus('error');
        setTaskError(`Failed to initialize connection: ${error instanceof Error ? error.message : String(error)}`);
        setActiveTaskId(null); // Clear task ID on setup failure
      }
    };

    // Add this ref before the useEffect
    const isInitialMount = useRef(true);
    const isUnmounting = useRef(false);

    // Replace the existing useEffect
    useEffect(() => {
        console.log(`[SSE useEffect] Running effect. activeTaskId: ${activeTaskId}`);

        // Skip setup on initial mount with no activeTaskId
        if (isInitialMount.current && !activeTaskId) {
            isInitialMount.current = false;
            return;
        }

        // Reset unmounting flag on each effect run
        isUnmounting.current = false;

        if (activeTaskId) {
            // Only setup if we don't already have a connection for this task
            if (!eventSourceRef.current || eventSourceRef.current.url.split('/').pop() !== activeTaskId) {
                setupSSE();
            }
        } else {
            // If there's no active task, ensure any existing connection is closed
            console.log("[SSE useEffect] activeTaskId is null, ensuring connection is closed.");
            closeEventSource();
        }

        // Cleanup function
        return () => {
            console.log(`[SSE useEffect Cleanup] Running cleanup for task ID (state): ${activeTaskId}. EventSource ref exists: ${!!eventSourceRef.current}`);
            
            // Skip cleanup if we're just re-rendering with the same task
            if (eventSourceRef.current?.url.split('/').pop() === activeTaskId && !isUnmounting.current) {
                console.log("[SSE useEffect Cleanup] Skipping cleanup as task ID hasn't changed and component isn't unmounting");
                return;
            }

            // Only warn about unexpected closures if we have an active connection that wasn't marked as cleanly closed
            if (!closedCleanlyRef.current && eventSourceRef.current) {
                console.warn("[SSE useEffect Cleanup] Closing EventSource due to task change or unmount");
            } else if (closedCleanlyRef.current) {
                console.log("[SSE useEffect Cleanup] Cleanup running, closure was marked as clean (completed/failed)");
            }

            closeEventSource();
        };
    }, [activeTaskId]);

    // Add a new useEffect for component unmount detection
    useEffect(() => {
        return () => {
            isUnmounting.current = true;
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
