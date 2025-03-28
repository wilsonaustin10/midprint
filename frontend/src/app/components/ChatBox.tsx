'use client'

import { useEffect, useRef, useState } from "react"
import ChatMessage from "./ChatMessage"
import { Button } from "@/components/ui/button"
import { Message } from "../../types/messages"
import { Textarea } from "@/components/ui/textarea"
import { processStream } from "@/lib/llm-text"
import { performAction, navigateTo } from "@/app/actions/browser"
import { BrowserActions } from "@/app/api/browser-service/actions"

type P = {
    initialMessages: Message[];
    sessionId: string;
    updateBrowserState: (result: any) => void;
}

export default function ChatBox({ initialMessages, sessionId, updateBrowserState }: P) {
    const [messages, setMessages] = useState<Message[]>(initialMessages)
    const [inputMessage, setInputMessage] = useState<string>("")
    const [isLoading, setIsLoading] = useState<boolean>(false)
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
            
            let result;
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
            } else {
                // Try to parse as search query
                result = await performAction(
                    BrowserActions.FILL_INPUT, 
                    'input[type="text"], input[type="search"], textarea', 
                    userInput,
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
                            content: `Searched for: ${userInput}`, 
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                } else {
                    setMessages(prevMessages => {
                        const newMessages = [...prevMessages];
                        newMessages[newMessages.length - 1] = { 
                            content: `Could not perform search for: ${userInput}. Try entering a URL instead.`, 
                            role: "assistant" 
                        };
                        return newMessages;
                    });
                }
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
        } finally {
            setIsLoading(false)
        }
    }
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto flex flex-col gap-2" style={{ scrollBehavior: "smooth", maxHeight: "calc(100% -70%" }}>
                {messages.map((message, index) => (
                    <ChatMessage key={index} {...message} />
                ))}
            </div>
            {/* <form onSubmit={handleSendMessage} className="border-t p-4 flex gap-2">
            </form> */}
                <Textarea
                    rows={1}
                    value={inputMessage}
                    className="cursor-pointer"
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Type your message here..." />
                <Button type="submit" onClick={handleSendMessage}>Send</Button>
                <Button type="submit" onClick={handleComputerUse}>computerUse</Button>
        </div>
    )
}
