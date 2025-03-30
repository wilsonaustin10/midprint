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

export default function ChatBox({ initialMessages, sessionId, updateBrowserState, addLog }: P) {
    const [messages, setMessages] = useState<Message[]>(initialMessages)
    const [inputMessage, setInputMessage] = useState<string>("")
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
    const [taskStatus, setTaskStatus] = useState<string | null>(null);
    const [taskError, setTaskError] = useState<string | null>(null);
    const [taskProgressInfo, setTaskProgressInfo] = useState<{ 
        current_step: number | null; 
        total_steps: number | null; 
        last_action?: string | null 
    }>({ current_step: null, total_steps: null, last_action: null });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentResponseRef = useRef<string>("");
    const eventSourceRef = useRef<EventSource | null>(null);
    const taskStatusRef = useRef<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [userMessage, setUserMessage] = useState("");
    const closedCleanlyRef = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    
    const memoizedAddLog = useCallback((log: string) => {
        addLog(log);
    }, [addLog]);

    useEffect(() => {
        taskStatusRef.current = taskStatus;
    }, [taskStatus]);

    const eventHandlers = useMemo(() => ({
        onOpen: () => {
            console.log(`[SSE] Connection opened for ${activeTaskId}`);
            memoizedAddLog(`SSE connection established for task ${activeTaskId}.`);
            setTaskStatus('connecting');
            setTaskError(null);
        },
        onError: (error: Event) => {
            if (!eventSourceRef.current) return; // Avoid errors if already cleaned up

            const currentState = eventSourceRef.current.readyState;

            // Check if we intended to close OR if the state is already CLOSED/CONNECTING
            // (CONNECTING might happen during immediate failed reconnect attempts after server close)
            if (closedCleanlyRef.current || currentState === EventSource.CLOSED || currentState === EventSource.CONNECTING) {
                console.log(`[SSE] Connection error/closure detected. Ref set: ${closedCleanlyRef.current}, State: ${currentState}. Likely clean shutdown.`, error);

                // Close again if it's somehow still open or connecting
                if (currentState !== EventSource.CLOSED && eventSourceRef.current) {
                    eventSourceRef.current.close();
                }
                eventSourceRef.current = null; // Nullify ref
                // Do NOT clear active task ID or set error message on clean/expected closure
                // We might still want to set isLoading to false eventually if it's stuck true
                // setIsLoading(false); // Consider adding this if loading gets stuck
                return;
            }

            // --- If none of the above, treat as a real error ---
            console.error(`[SSE] Genuine error event occurred for task_${activeTaskId}:`, error);
            console.error('[SSE] EventSource ReadyState at error:', currentState);
            console.error('[SSE] EventSource URL:', eventSourceRef.current.url);
            try {
                const eventDetails = { ...error }; // Basic properties might be available
                console.error('[SSE] Error event details:', eventDetails);
            } catch (e) {
                console.error('[SSE] Could not log error event details:', e)
            }

            setMessages((prev) => [
                ...prev,
                { id: Date.now().toString(), role: 'assistant', content: 'Connection error. Please try again.' },
            ]);
            setTaskError('SSE connection error.');
            setTaskStatus('error');
            setIsLoading(false);
            setActiveTaskId(null); // Clear task ID on genuine error
            // Reset progress info back to its default object state, not null
            setTaskProgressInfo({ current_step: null, total_steps: null, last_action: null }); // Reset progress info

            if (eventSourceRef.current) { // Close just in case
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            closedCleanlyRef.current = false; // Ensure flag is reset for next time
        }
    }), [activeTaskId, memoizedAddLog]);

    useEffect(() => {
        let isCurrentEffect = true;
        
        const setupSSE = () => {
            if (!activeTaskId || eventSourceRef.current) {
                return;
            }

            console.log(`[SSE] Setting up new connection for task: ${activeTaskId}`);
            setTaskStatus('initializing');
            setTaskError(null);
            setTaskProgressInfo({ current_step: 0, total_steps: null, last_action: 'Task starting...' });
            closedCleanlyRef.current = false;
            
            try {
                const url = `${SERVICE_BASE_URL}${ENDPOINTS.TASK_STATUS}/${activeTaskId}/stream`;
                const es = new EventSource(url);
                eventSourceRef.current = es;

                es.onopen = eventHandlers.onOpen;
                es.onerror = eventHandlers.onError;

                const addEventHandler = (eventType: string, handler: (data: any) => void) => {
                    const wrappedHandler = (event: MessageEvent) => {
                        if (!isCurrentEffect) return;
                        
                        console.log(`[SSE] Received event '${eventType}':`, event.data);

                        if (event.type === 'error') {
                            console.error("[SSE] Received SSE event with type 'error', data:", event.data);
                            if (event.data === undefined) return;
                        }

                        try {
                            const parsedData = JSON.parse(event.data);
                            handler(parsedData);
                        } catch (error) {
                            console.error(`[SSE] Failed to parse JSON for event '${eventType}':`, error, "Raw data:", event.data);
                            setMessages((prev) => [
                                ...prev,
                                { id: Date.now().toString(), role: 'assistant', content: `Error processing event data: ${event.data}` },
                            ]);
                            setTaskError(`Failed to process event: ${event.type}`);
                        }
                    };
                    es.addEventListener(eventType, wrappedHandler);
                };

                addEventHandler("status", (data) => {
                    addLog(`Task Status: ${data.status} - ${data.message || ''}`);
                    setTaskStatus(data.status);
                    setTaskProgressInfo(prev => ({ 
                        ...prev, 
                        current_step: data.current_step ?? prev?.current_step ?? 0, 
                        total_steps: data.total_steps ?? prev?.total_steps ?? 30 
                    }));
                    setTaskError(null);
                    setMessages(prev => {
                        const newMessages = [...prev];
                        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                            if (!newMessages[newMessages.length - 1].content.startsWith("Task completed") && !newMessages[newMessages.length - 1].content.startsWith("Task failed")) {
                                 newMessages[newMessages.length - 1].content = `Task ${data.status}: ${data.message || 'In progress...'}`;
                            }
                        }
                        return newMessages;
                    });
                });

                addEventHandler("log", (data) => {
                    addLog(`Agent Log: ${data.message}`);
                });

                 addEventHandler("agent_step", (data) => {
                    addLog(`Agent Step ${data.step}: ${data.message || ''}`);
                    setTaskStatus("running");
                    setTaskProgressInfo(prev => ({ 
                        ...prev, 
                        current_step: data.step, 
                        last_action: data.message, 
                        total_steps: prev?.total_steps ?? 30
                    }));
                    setTaskError(null);
                    if (data.screenshot) {
                        updateBrowserState({ screenshot: data.screenshot });
                    }
                    if (data.url) {
                        updateBrowserState({ url: data.url });
                    }
                });

                 addEventHandler("history_update", (data) => {
                     addLog(`Agent History Update (Step ${data.step})`);
                     setTaskStatus("running");
                     setTaskProgressInfo(prev => ({ 
                        ...prev, 
                        current_step: data.step, 
                        total_steps: prev?.total_steps ?? 30
                     }));
                     if (data.history && data.history.length > 0) {
                        const lastItem = data.history[data.history.length - 1];
                        const actionContent = lastItem?.data?.extracted_content || lastItem?.content || 'Processing...';
                        setTaskProgressInfo(prev => ({...prev, last_action: actionContent }));
                     }
                     if (data.screenshot) updateBrowserState({ screenshot: data.screenshot });
                     if (data.url) updateBrowserState({ url: data.url });
                 });

                addEventHandler("completed", (data: TaskCompletionData) => {
                    console.log('[SSE] Task completed event received:', data);
                    setTaskStatus('completed');
                    setTaskError(null);
                    setMessages((prev) => {
                        const lastMessage = prev[prev.length - 1];
                        if (lastMessage?.role === 'assistant' && lastMessage.content === 'Processing...') {
                            return [
                                ...prev.slice(0, -1),
                                { id: Date.now().toString(), role: 'assistant', content: data.result ?? 'Task completed.' },
                            ];
                        }
                        return [
                            ...prev,
                            { id: Date.now().toString(), role: 'assistant', content: data.result ?? 'Task completed.' },
                        ];
                    });

                    setIsLoading(false);
                    closedCleanlyRef.current = true;
                });

                addEventHandler("failed", (data) => {
                    addLog(`Task Failed: ${data.error || 'Unknown reason'}`);
                    setTaskStatus("failed");
                    setTaskError(data.error || 'Unknown reason');
                     setMessages(prev => {
                        const newMessages = [...prev];
                        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                            newMessages[newMessages.length - 1].content = `Task failed: ${data.error || 'Unknown error'}`;
                        } else {
                            newMessages.push({ role: 'assistant', content: `Task failed: ${data.error || 'Unknown error'}` });
                        }
                        return newMessages;
                    });
                    setIsLoading(false);
                    setActiveTaskId(null);
                    performAction(BrowserActions.REFRESH, "", null, sessionId).then(updateBrowserState);
                    es.close();
                    eventSourceRef.current = null;
                });
                 
                 addEventHandler("error", (data) => {
                     console.error("[SSE] Received error event data:", data);
                     
                     let errorMsg = 'Unknown stream error';
                     if (data && typeof data === 'object' && data.error) {
                         errorMsg = String(data.error);
                     } else if (typeof data === 'string') {
                         errorMsg = data;
                     } else {
                         console.warn("[SSE] Received 'error' event with unexpected data format:", data);
                         errorMsg = 'Received malformed error event from server.';
                     }
                     
                     addLog(`Task Error: ${errorMsg}`);
                     setTaskStatus("failed");
                     setTaskError(errorMsg);
                      setMessages(prev => {
                        const newMessages = [...prev];
                        if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                            if (!newMessages[newMessages.length - 1].content.includes("Task completed") && !newMessages[newMessages.length - 1].content.includes("Task failed")) {
                                newMessages[newMessages.length - 1].content = `Task failed with error: ${errorMsg}`;
                            } else {
                                 newMessages.push({ role: 'assistant', content: `Task failed with error: ${errorMsg}` });
                            }
                        } else {
                            newMessages.push({ role: 'assistant', content: `Task failed with error: ${errorMsg}` });
                        }
                        return newMessages;
                    });
                     setIsLoading(false);
                     setActiveTaskId(null);
                     performAction(BrowserActions.REFRESH, "", null, sessionId).then(updateBrowserState);
                     
                     if (eventSourceRef.current) { 
                        eventSourceRef.current.close();
                        eventSourceRef.current = null;
                     }
                 });
                 
                  addEventHandler("debug", (data) => {
                      console.log("[SSE Debug]", data);
                  });

                addEventHandler("closed", () => {
                    console.log(`[SSE] Server closed connection for ${activeTaskId}`);
                    if (eventSourceRef.current) {
                        eventSourceRef.current.close();
                        eventSourceRef.current = null;
                    }
                    if (taskStatusRef.current !== 'completed' && taskStatusRef.current !== 'failed') {
                         setTaskStatus('closed');
                         setTaskError('Connection closed by server.');
                    }
                });

            } catch (error) {
                console.error(`[SSE] Error setting up EventSource:`, error);
                memoizedAddLog(`Failed to establish SSE connection: ${error}`);
                setTaskStatus('error');
                setTaskError(`Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        setupSSE();

        return () => {
            isCurrentEffect = false;
            if (eventSourceRef.current) {
                console.log(`[SSE] Cleaning up connection for ${activeTaskId}`);
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };
    }, [activeTaskId, eventHandlers]);

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
        setTaskStatus(null);
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
