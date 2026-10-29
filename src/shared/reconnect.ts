// A WebSocket that reconnects with backoff and pings at app level, since browser JS cannot see
// WebSocket ping frames (ADR 0001). The Device sync client and the /watch pages share it.

const pingIntervalMs = 5000;
const pongTimeoutMs = 10_000;

// 0.5, 1, 2, 4, then at most 5 s.
function reconnectDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 5000);
}

export type ReconnectingSocket = { send(message: unknown): void; close(): void };

export function openReconnecting(options: {
  url: string;
  createSocket?: (url: string) => WebSocket; // the Device sync client takes its WebSocket from the caller (ADR 0007)
  onOpen?: () => void; // runs before the first ping, so a Device can send hello first
  onMessage: (message: unknown) => void; // every parsed message except pong
  onConnectedChange: (connected: boolean) => void; // connected while the last pong is under 10 s old
}): ReconnectingSocket {
  let socket: WebSocket | undefined;
  let attempt = 0;
  let stopped = false;
  let connected = false;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function setConnected(value: boolean): void {
    if (connected === value) return;
    connected = value;
    options.onConnectedChange(value);
  }

  function send(message: unknown): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  // Drops the socket if no pong arrives within 10 s, including the first one after open.
  function expectPong(ws: WebSocket): void {
    clearTimeout(pongTimer);
    pongTimer = setTimeout(() => lost(ws), pongTimeoutMs);
  }

  // A socket counts as healthy from its second pong, 5 s in; a Device whose push is refused right
  // after its first pong is closed again, and must keep backing off.
  let pongs = 0;

  function onPong(ws: WebSocket): void {
    if (++pongs > 1) attempt = 0;
    setConnected(true);
    expectPong(ws);
  }

  function connect(): void {
    const ws = options.createSocket?.(options.url) ?? new WebSocket(options.url);
    socket = ws;
    pongs = 0;
    ws.onopen = () => {
      options.onOpen?.();
      send({ type: "ping" });
      pingTimer = setInterval(() => send({ type: "ping" }), pingIntervalMs);
      expectPong(ws);
    };
    ws.onmessage = (e) => {
      let message: unknown;
      try {
        message = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if ((message as { type?: unknown } | null)?.type === "pong") onPong(ws);
      else options.onMessage(message);
    };
    // An error is always followed by close.
    ws.onclose = () => lost(ws);
  }

  // Drops the socket without waiting for its close handshake, which can hang on a dead network.
  function lost(ws: WebSocket): void {
    if (socket !== ws) return;
    socket = undefined;
    ws.onopen = ws.onmessage = ws.onclose = null;
    ws.close();
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    setConnected(false);
    if (!stopped) retryTimer = setTimeout(connect, reconnectDelay(attempt++));
  }

  connect();

  return {
    send,
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      if (socket) lost(socket);
    },
  };
}
