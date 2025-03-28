import { useEffect } from 'react';
import { io } from 'socket.io-client';

interface Props {
    sessionId: string;
}

export default function UpdateListener({ sessionId }: Props) {
    useEffect(() => {
        const socket = io({
            path: "/api/ws",
            query: { sessionId },
            transports: ["websocket"],
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        socket.on("connect", () => {
            console.log("Connected to server");
        });

        socket.on("disconnect", () => {
            console.log("Disconnected from server");
        });

        return () => {
            socket.disconnect();
        };
    }, [sessionId]);

    return null;
} 