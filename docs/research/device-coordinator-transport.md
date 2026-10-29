# Transport between Device and Coordinator

Research for GitHub issue #2. Checked on 2026-10-29.

## Question

Which transport should carry events between a **Device** (one browser tab) and the **Coordinator** (Node 24 + TypeScript, same repo as the Vite + React frontend): WebSocket, Server-Sent Events (SSE) plus HTTP POST, or polling? And which library?

Needs:

1. The Device pushes its unsent events.
2. The Coordinator pushes, in realtime, new events of the Incidents the Device follows.
3. The Device notices a lost connection fast enough to drive an online / offline indicator.
4. The Device reconnects on its own.

Context: local demo, 4-5 tabs on one machine, online only, no auth. Simplicity over scale.

Note: README.md still says "no server" and lists "A real Node server with WebSocket" as stretch goal 6. CONTEXT.md and this ticket assume a Node Coordinator. This note follows the ticket.

## What the domain already gives us

The README rules already make delivery safe to repeat: every event has an `eventId` made on the Device, the Coordinator "stores each `eventId` once", and "sends a tablet only the events after its offset". So the transport does **not** need its own delivery guarantees, acks or replay. After a reconnect the Device can resend everything unsent and ask for everything after its offset. This removes the main reason to pick a heavier library.

## Facts from primary sources

### Browser side

- **WebSocket** (MDN, [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)): events `open`, `message`, `close`, `error`. No built-in reconnect and no ping / heartbeat API in the browser object. Reconnect and liveness checks are app code.
- **EventSource** (WHATWG HTML spec, [Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)):
  - On a network error the browser will "reestablish the connection", after a "reconnection time" that is "implementation-defined, probably in the region of a few seconds"; the server can set it with the `retry:` field. `readyState` goes to `CONNECTING`.
  - On reconnect the browser sends a `Last-Event-ID` header, which maps well onto the Coordinator's per-Device offset.
  - If the response status is not 200, or the `Content-Type` is not `text/event-stream`, the browser will "fail the connection": `readyState` becomes `CLOSED` and "it does not attempt to reconnect". So auto-reconnect is not guaranteed in every failure case.
  - EventSource is one-way (server to browser). Device to Coordinator needs separate `fetch` POSTs.
- **SSE connection limit** (MDN, [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), page last modified 2025-03-13): "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections, which can be specially painful when opening various tabs as the limit is per browser and set to a very low number (6)." Marked "Won't fix" in Chrome and Firefox. Over HTTP/2 the limit is negotiated (default 100).
- **`navigator.onLine`** (MDN, [Navigator.onLine](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)): "inherently unreliable". It also says nothing about whether the Coordinator is reachable, so the indicator must come from the transport itself.
- **Background tab timers** (Chrome blog, [Heavy throttling of chained JS timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)): timers in hidden pages are checked "once per second"; after 5 minutes hidden (plus other conditions) chained timers run once per minute. A client-side heartbeat timeout in a hidden tab can therefore fire late. The post mentions a flag `AllowAggressiveThrottlingWithWebSocket`, but I could not confirm from it exactly how open WebSockets change throttling.

### Server side (Node 24)

- Node core has a global `WebSocket` class, "a browser-compatible implementation", stable since v22.4.0 ([Node v24 globals docs](https://github.com/nodejs/node/blob/v24.x/doc/api/globals.md)). This is a **client**. Node core has no WebSocket server; a server needs the `http` `'upgrade'` event plus a library.
- **`ws`** 8.22.0 (npm, published 2026-09-26), zero dependencies ([README](https://github.com/websockets/ws)):
  - "This module does not work in the browser." Browsers use the native `WebSocket`.
  - Its README shows a heartbeat: the server calls `ws.ping()` every interval and `terminate()`s any client that did not answer with a pong. Browsers answer pings automatically ("Pong messages are automatically sent in response to ping messages as required by the spec"), but browser JS cannot see pings, so the Device side needs an app-level heartbeat message.
  - `noServer` + `handleUpgrade` lets it share an existing HTTP server.
- **`@fastify/websocket`** 11.3.4 (npm, 2026-10-09), for Fastify 5.12.7: "Built upon ws@8". Route option `{ websocket: true }`. README warns handlers "must attach event listeners synchronously ... to avoid accidentally dropping messages". I did not find a version compatibility table in the README.
- **Hono** 4.13.14 with **`@hono/node-server`** 2.1.5 (npm, 2026-10-25 and 2026-10-13): per the [Hono WebSocket helper docs](https://hono.dev/docs/helpers/websocket), "On Node.js, WebSocket support is built into `@hono/node-server`": install `ws`, create `new WebSocketServer({ noServer: true })`, pass it to `serve()` via the `websocket` option. "`@hono/node-ws` is deprecated" (the [node-ws README](https://github.com/honojs/middleware/tree/main/packages/node-ws) agrees). Handlers: `onOpen`, `onMessage`, `onClose`, `onError`. Warning: middleware that changes headers (for example CORS) on the WebSocket route can throw.
- **socket.io** 4.8.4 / **socket.io-client** 4.8.4 (npm, 2026-09-25):
  - "Socket.IO is NOT a WebSocket implementation"; a plain WebSocket client cannot talk to a Socket.IO server and the other way round ([docs intro](https://socket.io/docs/v4/)). Client bundle about 10.4 kB min+gzip per that page.
  - Client reconnects by default: `reconnection: true`, attempts `Infinity`, delay 1000 ms up to 5000 ms, randomization 0.5 ([client options](https://socket.io/docs/v4/client-options/)).
  - Heartbeat built in: server `pingInterval` 25000 ms, `pingTimeout` 20000 ms ([server options](https://socket.io/docs/v4/server-options/)). With defaults, a silent dead link can take about 45 s to notice; both values are configurable.
  - Delivery is "at most once" by default; missed server events are not replayed; the docs recommend unique ids plus a stored offset for at-least-once ([delivery guarantees](https://socket.io/docs/v4/delivery-guarantees)). That is exactly what the Coordinator already does.
  - "any event emitted while the Socket is not connected will be buffered until reconnection" ([offline behavior](https://socket.io/docs/v4/client-offline-behavior/)). This would duplicate the Device's own pending queue in its Event log.
- **partysocket** 1.3.0 (npm, 2026-06-23), "A better WebSocket that Just Works", from the Cloudflare partykit repo: a reconnecting wrapper over the browser WebSocket. I only checked its npm metadata, not its API docs.
- **Vite** 8.3.5 (npm, 2026-10-21): `server.proxy` supports `ws: true` to proxy WebSockets, and warns that Vite "does not check the origin of WebSocket requests before proxying" ([server options](https://github.com/vitejs/vite/blob/main/docs/config/server-options.md)). Plain `vite` dev serves HTTP/1.1; `server.https` enables "TLS + HTTP/2" but needs a certificate.

## Comparison

| | WebSocket (`ws` + browser `WebSocket`) | SSE + HTTP POST | Polling (`fetch` on a timer) | socket.io |
|---|---|---|---|---|
| Device pushes unsent events | Same socket | Separate POST per batch | POST | `emit` |
| Coordinator pushes in realtime | Yes | Yes | No, delay = poll interval | Yes |
| Notice lost connection | `close` fires; add a small app heartbeat for a hung Coordinator | `error` event, `readyState` | Failed request | Built-in heartbeat (`disconnect` event) |
| Reconnect on its own | No, about 20-30 lines of app code (or partysocket) | Yes for network errors; **not** after a non-200 or wrong Content-Type (spec) | Implicit, next tick | Yes, by default |
| Connections per tab | 1 | 1 SSE stream + POSTs | Short requests | 1 |
| 4-5 tabs on HTTP/1.1 | No issue found | **Hits the 6-per-browser SSE limit** (MDN): 5 streams leave 1 slot for every POST | Fine | No issue found |
| Resume after reconnect | App sends its offset on connect | `Last-Event-ID` built in | App sends offset | App sends offset (built-in recovery is time-limited and optional) |
| Extra dependencies | `ws` (0 deps), or the framework adapter | None | None | `socket.io` + `socket.io-client`, own protocol |
| Fits the "Coordinator could be swapped later" goal | Plain protocol, any client | Plain HTTP | Plain HTTP | Locks both ends to socket.io |

## Recommendation

**Use plain WebSocket: `ws` on the Coordinator and the browser's native `WebSocket` on the Device, with a small hand-written reconnect loop and an app-level heartbeat.**

Why:

- One connection per tab carries both directions, which matches "Device pushes unsent events" and "Coordinator pushes new events" without a second channel.
- SSE + POST is the closest runner-up (free reconnect and `Last-Event-ID`), but the MDN 6-connection limit applies across all tabs on plain HTTP/1.1, and the demo runs 4-5 tabs in one browser. Fixing that means HTTP/2 with a TLS certificate, which costs more than it saves. Its auto-reconnect also stops after a non-200 response, so some manual reconnect code is needed anyway.
- socket.io would give reconnect and heartbeat for free, but its main extras (acks, offline buffering, state recovery) duplicate what the Coordinator already does with `eventId` dedup and per-Device offsets, and its offline buffer would compete with the Device's own pending queue. It also locks both ends to its protocol. It is the fallback if writing the reconnect loop feels like too much.
- Polling cannot push in realtime.

Library choice for the server: if the Coordinator uses no framework, use `ws` directly on a `node:http` server. If the team picks Hono, use the built-in support in `@hono/node-server` (not the deprecated `@hono/node-ws`). If it picks Fastify, use `@fastify/websocket`. All three run on `ws` underneath, so the message protocol is the same.

Sketch of the protocol (not verified by running code):

- On `open`: Device sends `{ type: "hello", deviceId, offset }`, then all its unsent events. Indicator: online.
- Coordinator sends `{ type: "events", events, offset }` for anything new in the Incidents the Device follows, and `{ type: "ping" }` every few seconds (for example 5 s).
- Device marks offline on `close`, or when no message has arrived for about 2-3 ping intervals, then retries with a capped backoff (for example 0.5 s doubling to 5 s).
- Coordinator also uses the `ws` ping/pong pattern from the `ws` README to drop dead sockets.
- The demo's per-Device Online / Offline switch can simply close the socket and stop reconnecting.

## Not verified

- That a stopped Coordinator process on localhost makes the browser fire `close` immediately. I expect it (the OS closes the TCP socket), but found no primary source; test it.
- How browsers limit WebSocket connections per host. I found no primary source; with 4-5 tabs it is very unlikely to matter.
- What status code the Vite proxy returns when the Coordinator is down. This matters only for SSE (a non-200 stops EventSource for good).
- Exact effect of an open WebSocket on Chrome timer throttling in hidden tabs. If the tabs are side by side in separate visible windows, this does not apply.
- partysocket's API and behavior beyond its npm description.
