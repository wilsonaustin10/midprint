'use client'

import { useEffect, useRef, useState } from "react"
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
    updateBrowserState: (result: any) => void;
}

export default function ChatBox({ initialMessages, sessionId, updateBrowserState }: P) {
    const [messages, setMessages] = useState<Message[]>(initialMessages)
    const [inputMessage, setInputMessage] = useState<string>("")
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentResponseRef = useRef<string>("");

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
            // Note: You MUST use the synchronous API to update the messages here, or it will override the previous user message
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
                return;
            }

            await processStream(response, currentResponseRef, setMessages)
        } catch (error) {
            console.error("Error generating chat response:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleComputerUse = async (e: React.FormEvent<HTMLButtonElement>) => {
        e.preventDefault()
        if (!inputMessage.trim() || isLoading) return;
        setMessages(prevMessages => [...prevMessages, { content: inputMessage, role: "user" }])
        setInputMessage("")
        setIsLoading(true);

        currentResponseRef.current = "";
        try {
            setMessages(prevMessages => [...prevMessages, { content: "Processing your action...", role: "assistant" }])
            
            let result: ActionResult | null = null;
            const userInput = inputMessage.trim();
            
            // Check if input looks like a URL
            if (userInput.startsWith('http://') || userInput.startsWith('https://') || 
                userInput.match(/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?$/)) {
                // Handle as URL navigation
                const url = userInput.startsWith('http') ? userInput : `https://${userInput}`;
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
                } else {
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { 
                            content: `Failed to navigate to: ${url}`, 
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                }
            } else if (userInput.toLowerCase().startsWith('search:') || userInput.toLowerCase().startsWith('search ')) {
                // Explicitly handle search queries
                const searchQuery = userInput.replace(/^search:?\s*/i, '').trim();
                
                // Try to parse as search query
                result = await performAction(
                    BrowserActions.FILL_INPUT, 
                    'input[type="text"], input[type="search"], textarea', 
                    searchQuery,
                    sessionId
                );
                
                if (result.success) {
                    // After filling input, try to submit the form
                    const submitResult = await performAction(
                        BrowserActions.PRESS,
                        'input[type="text"], input[type="search"], textarea',
                        'Enter',
                        sessionId
                    );
                    
                    result = submitResult; // Use the result of the submission
                    
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { 
                            content: `Searched for: ${searchQuery}`, 
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                } else {
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { 
                            content: `Could not perform search for: ${searchQuery}. Try entering a URL instead.`, 
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                }
            } else {
                // Handle as a browser automation task using the browser-use agent
                setMessages(prevMessages => {
                    const newMessages = [...prevMessages];
                    newMessages[newMessages.length - 1] = { 
                        content: `Processing your task: "${userInput}"...`, 
                        role: "assistant" 
                    };
                    return newMessages;
                });
                
                // Start the agent task
                const response = await fetch(`${SERVICE_BASE_URL}/run-agent`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        task: userInput,
                        max_steps: 30,
                        config: {
                            llm: {
                                provider: 'openai',
                                model: 'gpt-4'
                            }
                        },
                        browser_info: {
                            headless: true
                        }
                    }),
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to start agent task: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                // Store the task ID to show progress
                setActiveTaskId(data.task_id);
                
                // The actual runAgentTask function will be called when task completes
                result = null;
                
                // Don't set loading to false yet - we'll wait for task completion
                return;
            }
            
            // Update the browser state with the result
            if (result && result.success) {
                updateBrowserState(result);
            }
        } catch (error) {
            console.error("Error performing browser action:", error);
            setMessages(prevMessages => {
                // Update the last message with an error message
                const newMessages = [...prevMessages];
                newMessages[newMessages.length - 1] = { 
                    content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
                    role: "assistant" 
                };
                return newMessages;
            });
            setIsLoading(false);
        }
    }
    
    // Handle task completion
    const handleTaskComplete = async () => {
        if (!activeTaskId) return;
        
        try {
            // Get the task result
            const response = await fetch(`${SERVICE_BASE_URL}/task/${activeTaskId}`);
            if (!response.ok) {
                throw new Error(`Failed to get task result: ${response.statusText}`);
            }
            
            const taskData = await response.json();
            
            // Update the message with the task result
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                if (taskData.status === "completed") {
                    newMessages[newMessages.length - 1] = { 
                        content: taskData.result || "Task completed successfully!", 
                        role: "assistant" 
                    };
                } else {
                    newMessages[newMessages.length - 1] = { 
                        content: `Task ${taskData.status}: ${taskData.error || "No details available"}`, 
                        role: "assistant" 
                    };
                }
                return newMessages;
            });
            
            // Refresh the browser state
            const result = await performAction(BrowserActions.REFRESH, "", null, sessionId);
            if (result.success) {
                updateBrowserState(result);
            }
        } catch (error) {
            console.error("Error handling task completion:", error);
            setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                newMessages[newMessages.length - 1] = { 
                    content: `Error getting task result: ${error instanceof Error ? error.message : 'Unknown error'}`, 
                    role: "assistant" 
                };
                return newMessages;
            });
        } finally {
            // Clear the active task ID and set loading to false
            setActiveTaskId(null);
            setIsLoading(false);
        }
    }
    
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto flex flex-col gap-2" style={{ scrollBehavior: "smooth", maxHeight: isLoading && activeTaskId ? "calc(100% - 200px)" : "calc(100% - 70px)" }}>
                {messages.map((message, index) => (
                    <ChatMessage key={index} {...message} />
                ))}
                <div ref={messagesEndRef} />
            </div>
            
            {/* Show task progress if there's an active task */}
            {isLoading && activeTaskId && (
                <div className="mt-2 mb-4">
                    <TaskProgress 
                        taskId={activeTaskId} 
                        onComplete={handleTaskComplete} 
                    />
                </div>
            )}
            
            <Textarea
                rows={1}
                value={inputMessage}
                className="cursor-pointer"
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type a message to chat, or use Browser Action for web automation tasks" />
            <div className="flex gap-2 mt-2">
                <Button type="submit" onClick={handleSendMessage} disabled={isLoading}>Chat with AI</Button>
                <Button type="submit" onClick={handleComputerUse} disabled={isLoading}>Browser Action</Button>
            </div>
        </div>
    )
}
