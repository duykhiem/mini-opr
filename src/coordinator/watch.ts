import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { WatchMessage, WatchSnapshot } from "../shared/watch.ts";

// The read-only /watch channel for the EOC and Coordinator pages (ADR 0008).
export type WatchChannel = {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  broadcast(message: WatchMessage): void;
  close(): void;
};

function send(ws: WebSocket, message: WatchMessage): void {
  ws.send(JSON.stringify(message));
}

function isPing(data: RawData): boolean {
  try {
    return (JSON.parse(String(data)) as { type?: unknown }).type === "ping";
  } catch {
    return false;
  }
}

export function createWatchChannel(snapshot: () => WatchSnapshot): WatchChannel {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    send(ws, { type: "snapshot", ...snapshot() });
    // A page only pings; anything else is ignored.
    ws.on("message", (data) => {
      if (isPing(data)) send(ws, { type: "pong" });
    });
  });

  return {
    handleUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    broadcast(message) {
      for (const ws of wss.clients) if (ws.readyState === ws.OPEN) send(ws, message);
    },
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
