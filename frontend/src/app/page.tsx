'use client'

import { useEffect, useState } from "react";
import ChatBox from "./components/ChatBox";
import { Message } from "../types/messages";
import InteractiveBrowser from "./components/InteractiveBrowser";


const sessionId = crypto.randomUUID();
console.log("Session id is", sessionId)

export default function Home() {
  const [initialMessages, setInitialMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello, I'm the AutonoM3 Agent Building Assistant. How can I help you today?" }
  ])

  const [screenshot, setScreenshot] = useState<string>('')
  const [pageTitle, setPageTitle] = useState<string>('')

  const [formElements, setFormElements] = useState<{
    tagName: string;
    id: string;
    name: string;
    type: string;
    value: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[]>([])

  const [historyState, setHistoryState] = useState<{
    canGoBack?: boolean;
    canGoForward?: boolean;
  }>({})
  const [url, setUrl] = useState<string>('https://google.com')


  useEffect(() => {
    const eventSource = new EventSource(`/api/computer-use?sessionId=${sessionId}`)

    eventSource.onmessage = (event) => {
      const {pageInfo} = JSON.parse(event.data);
      updateBrowserState(pageInfo)
    }

    eventSource.onerror = (error) => {
      console.error("Error fetching computer use updates:", error)
      eventSource.close()
    }

    return () => {
      eventSource.close();
    }
    
  }, [sessionId])

  // Add this function to update browser state from API responses
  const updateBrowserState = (result: any) => {
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
        <div className="md:col-span-2 bg-gray-100 border border-1 p-4">
          <ChatBox 
            sessionId={sessionId} 
            initialMessages={initialMessages} 
            updateBrowserState={updateBrowserState}
          />

        </div>
        <div className="md:col-span-3 bg-gray-100">
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
