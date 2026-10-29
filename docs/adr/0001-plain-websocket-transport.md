# Plain WebSocket between Device and Coordinator

Devices and the Coordinator talk over one plain WebSocket per Device: `ws` on the Coordinator, the browser's own `WebSocket` on the Device. The Device adds its own reconnect loop with backoff and an app-level ping, because browser JS cannot see WebSocket ping frames. It is the only option that pushes both ways in realtime without tying both ends to a library's own protocol.

## Considered options

- **SSE plus HTTP POST:** browsers allow 6 SSE connections per origin over HTTP/1.1, shared across tabs, and the demo runs 4 to 5 tabs. EventSource also stops reconnecting for good after a non-200 response.
- **socket.io:** its acks and offline buffer duplicate our own dedup by `eventId` and per-Device Offsets, and it ties both ends to its protocol.
- **Polling:** no realtime push.

If a server framework is added later, `@fastify/websocket` or the WebSocket support in `@hono/node-server` 2.x both run on `ws`.

Source: [Transport between Device and Coordinator](https://github.com/duykhiem/mini-opr/issues/2).
