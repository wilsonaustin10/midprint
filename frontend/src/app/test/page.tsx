
'use client'

import { Button } from "@/components/ui/button";
import { processStream } from "@/lib/llm-text";
import { Message } from "@/types/messages";

import { useEffect, useRef, useState } from "react";
import ChatMessage from "../components/ChatMessage";
import { io, Socket } from "socket.io-client";
import UpdateListener from "./update-listener";

const sessionId = crypto.randomUUID();

export default function TestPage() {
    async function getHtmlData(url: string) {
        const response = await fetch(url);
        const html = await response.text();
        return html;
    }
    const handleClick = async (e: React.MouseEvent<HTMLDivElement>) => {
        // console.log(e.clientX, e.clientY)
        // const rect = e.currentTarget.getBoundingClientRect();
        // console.log(rect.left, rect.top, rect.width, rect.height);

        const html = await getHtmlData("https://www.google.com");
        console.log("Making the call")
        const response = await fetch("/api/processing", {
            method: "POST",
            body: JSON.stringify({ content: html, url: "https://www.google.com" })
        });
        console.log("done the call")
        const {html: shortenedHtml, interactiveElements} = await response.json();
        console.log("shortened html", shortenedHtml.length, shortenedHtml);
        console.log("interactive elements", interactiveElements);
        // console.log("full html", html.length, html);
    }

    const currentResponseRef = useRef<string>("");
    const [messages, setMessages] = useState<Message[]>([]);
    const socketRef = useRef<Socket | null>(null);


    useEffect(() => {
        // if (sessionId) {
        //     fetch(`/api/ws?sessionId=${sessionId}`)
        //         .then(response => {
        //             if (response.ok) {
        //                 const socket = io({
        //                     path: "/api/ws",
        //                     query: {
        //                         sessionId
        //                     },
        //                     transports: ["websocket"],
        //                     reconnectionAttempts: 5,
        //                     reconnectionDelay: 1000,
        //                 })


        //                 socket.on("connect", () => {
        //                     console.log("Connected to server")
        //                 })

        //                 socket.on("welcome", (data) => {
        //                     console.log("Welcome message from server", data)
        //                 })

        //                 socket.on("client-message", (data) => {
        //                     console.log("Client message", data)
        //                 })
                        
        //                 socket.on("disconnect", () => {
        //                     console.log("Disconnected from server")
        //                 })

        //                 socketRef.current = socket;

        //             } else {
        //                 console.error("Failed to connect to server")
        //             }
        //         })
        //         .catch(error => {
        //             console.error("Error connecting to server", error)
        //         })
        // }

        // return () => {
        //     if (socketRef.current) {
        //         socketRef.current.disconnect();
        //     }
        // }
    }, [])
    const handleButtonClick = async () => {

        const sessionId = crypto.randomUUID();
        const response = await fetch("/api/computer-use", {
            method: "POST",
            body: JSON.stringify({
                messageHistory: [],
                userMessage: "What is the top post on Reddit today?",
                sessionId
            })
        })
        
        const data = await response.json()
        if (data.success) {
            console.log(data.response);
        }
    }

    const handleWSS = async () => {
        if (socketRef.current) {
            console.log("Emitting message")
            socketRef.current.emit("client-message", "Hello from client")
        } else {
            console.error("No socket connection")
        }
    }

    return (
        <div className="w-screen h-[100vh] flex items-center justify-center">
            <div className="w-10 h-10 bg-red-500" onClick={handleClick}></div>
            {/* <Button className="" onClick={handleButtonClick}>Computer Use</Button> */}
            <Button className="cursor-pointer" onClick={handleWSS}>Websocket test</Button>
            <div>
                {messages.map((message, index) => (
                    <ChatMessage key={index} {...message} />
                ))}
            </div>
            <UpdateListener sessionId={sessionId} />
        </div>
    )
}
