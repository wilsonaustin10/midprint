import { NextRequest } from "next/server";
import { executeTaskLoop, getPageInfo } from "./task";
import { omit } from "lodash";

/**
 * a server-side streaming endpoint. Only valid for GET requests
 * @param req 
 * @returns 
 */
export async function GET(req: NextRequest) {
    try {

        const headers = {
            "Content-Type": "text/event-stream",
            "Connection": "keep-alive",
            "Cache-Control": "no-cache"
        }

        const {searchParams} = new URL(req.url);
        const sessionId = searchParams.get("sessionId");

        if (!sessionId) {
            return new Response("Missing sessionId", {status: 400})
        }

        // Provide periodic updates of the current browser state to the client
        const stream = new ReadableStream({
            async start(controller) {
                const sendUpdate = async () => {
                    const pageInfo = await getPageInfo(sessionId);
                    const data = JSON.stringify({
                        timestamp: new Date().toISOString(),
                        sessionId,
                        pageInfo: omit(pageInfo, ["content"]), // Avoid emitting the content as it is a very large payload
                    })
                    
                    controller.enqueue(`data: ${data}\n\n`)
                }

                sendUpdate();

                const interval = setInterval(sendUpdate, 5000);

                req.signal.addEventListener("abort", () => {
                    clearInterval(interval);
                    controller.close();
                })
            }
        })
        
        return new Response(stream, {
            headers
        })
    } catch (error) {
        console.error("Error generating computer use response:", error)
        return new Response("Internal Server Error", {status: 500})
    } 
}

/**
 * Handles the computer use API request.
 * @param req - The request object containing the messages and sessionId.
 * - @param req.messageHistory - The message history: string[]
 * - @param req.userMessage - The user message: string
 * - @param req.sessionId - The session ID: string
 * @returns A response from the OpenAI model.
 */

export async function POST(req: NextRequest) {
    try {
        const { messageHistory, userMessage, sessionId } = await req.json();
        const model = process.env.COMPUTER_USE_MODEL || "gpt-4o-mini";

        const response = await executeTaskLoop(model, userMessage, sessionId)
        
        const pageInfo = await getPageInfo(sessionId);
        return Response.json({
            response,
            pageInfo
        });
    } catch (error) {
        console.error("Error generating computer use response:", error)
        return new Response("Internal Server Error", {status: 500})
    } 
}