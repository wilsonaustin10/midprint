'use client'

import { useEffect, useState } from "react";
import ChatBox from "./components/ChatBox";
import { Message } from "../types/messages";
import InteractiveBrowser from "./components/InteractiveBrowser";
import { FormElement } from "../types/common";

const sessionId = crypto.randomUUID();
console.log("Session id is", sessionId)

export default function Home() {
  const [initialMessages, setInitialMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello, I'm the AutonoM3 Agent Building Assistant. How can I help you today?" }
  ])

  const [screenshot, setScreenshot] = useState<string>('')
  const [pageTitle, setPageTitle] = useState<string>('')
  const [formElements, setFormElements] = useState<FormElement[]>([])
  const [historyState, setHistoryState] = useState<{
    canGoBack?: boolean;
    canGoForward?: boolean;
  }>({})
  const [url, setUrl] = useState<string>('https://google.com')

  // We're now using the browser-use-service instead of the EventSource
  // This EventSource setup is no longer needed, but we'll keep a simplified
  // version to avoid breaking changes
  useEffect(() => {
    // In a development environment, we can skip the EventSource connection
    if (process.env.NODE_ENV === 'development') {
      return;
    }

    const eventSource = new EventSource(`/api/browser-service/events?sessionId=${sessionId}`)

    eventSource.onmessage = (event) => {
      try {
        const {pageInfo} = JSON.parse(event.data);
        updateBrowserState(pageInfo)
      } catch (error) {
        console.error("Error parsing event data:", error);
      }
    }

    eventSource.onerror = (error) => {
      console.error("Error fetching browser events:", error)
      eventSource.close()
    }

    return () => {
      eventSource.close();
    }
    
  }, [sessionId])

  // Add this function to update browser state from API responses
  const updateBrowserState = (result: any) => {
    if (!result) return;
    
    if (result.screenshot) {
      setScreenshot(result.screenshot);
    }
    if (result.title) {
      setPageTitle(result.title);
    }
    if (result.formElements) {
      setFormElements(result.formElements || []);
    }
    if (result.historyState) {
      setHistoryState(result.historyState);
    }
    if (result.url) {
      setUrl(result.url)
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <h1 className="text-4xl text-center leading-loose font-bold">AutonoM3 Agent Building</h1>
      <div className="flex-1 grid md:grid-cols-5 gap-4 p-4">
        <div className="md:col-span-2 bg-white rounded-lg shadow-md border p-4">
          <ChatBox 
            sessionId={sessionId} 
            initialMessages={initialMessages} 
            updateBrowserState={updateBrowserState}
          />
        </div>
        <div className="md:col-span-3 bg-white rounded-lg shadow-md border">
          <InteractiveBrowser 
            url={url}
            setUrl={setUrl}
            screenshot={screenshot}
            pageTitle={pageTitle}
            formElements={formElements}
            historyState={historyState}
            sessionId={sessionId} 
            updateBrowserState={updateBrowserState} />
        </div>
      </div>
    </div>
  );
}
