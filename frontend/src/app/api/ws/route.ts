import { NextRequest, NextResponse } from "next/server";
import { Server as SocketIOServer } from "socket.io";

// Store active Socket.io servers by session
export const sessionSockets: Map<string, SocketIOServer> = new Map();

let globalSocketIOInstance: SocketIOServer | null = null;

if (!global.socketIoInstance) global.socketIoInstance = globalSocketIOInstance

/**
 * Returns a websocket server instance for a given sessionId, establishing a websocket connection
 * @param req 
 * @returns 
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    
    if (!sessionId) {
        return new Response(`Missing sessionId`, { status: 400 });
    }

    // If this is called from socket.io client, let NextJS handle it
    if (req.url.includes("socket.io")) {
        console.log("Socket.io connection request");
        return new Response();
    }
    
    // For the initial handshake only
    const res = new NextResponse();
    const server = res.socket?.server;

    if (!globalSocketIOInstance) {
        // Create Socket.io server instance if it doesn't exist
        const io = new SocketIOServer(server, {
            path: "/api/ws",
            addTrailingSlash: false,
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        // Store the server instance globally
        globalSocketIOInstance = io;

        // Handle connections
        io.on("connection", (socket) => {
            console.log(`Client connected: ${socket.id}`);
            
            // Store the socket against sessionId
            socket.join(sessionId);
            sessionSockets.set(sessionId, io);
            
            // Send initial connection message
            socket.emit("welcome", { message: "Connected to server" });
            
            socket.on("client-message", (data) => {
                console.log("Received message from client", data)
            })
            // Handle disconnection
            socket.on("disconnect", () => {
                console.log(`Client disconnected: ${socket.id}`);
                if (sessionSockets.has(sessionId)) {
                    sessionSockets.delete(sessionId);
                }
            });
        });
        
        // Start the server
        // io.listen(3001); // Use a different port than your Next.js app/

    }
    
    return new Response("WebSocket server initialized", { status: 200 });
}

// Utility function to send updates to clients by sessionId
export function sendUpdate(sessionId: string, event: string, data: any) {
    const io = sessionSockets.get(sessionId);
    if (io) {
        io.to(sessionId).emit(event, data);
        return true;
    }
    return false;
}