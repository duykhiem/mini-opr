// The /watch client the EOC and Coordinator pages share; framework-free so it runs in Node tests (ADR 0008).
import { openReconnecting } from "./reconnect.ts";
import type { WatchMessage, WatchSnapshot } from "./watch.ts";

export type WatchView = {
  connected: boolean;
  data: WatchSnapshot | undefined; // undefined until the first snapshot; kept while disconnected
};

// Pages never run applyEvent: the Patient comes whole in each Incident.
function receive(data: WatchSnapshot | undefined, message: WatchMessage): WatchSnapshot | undefined {
  switch (message.type) {
    case "snapshot": {
      const { type: _, ...snapshot } = message;
      return snapshot;
    }
    case "incident": {
      if (!data) return data;
      const { incident } = message;
      const known = data.incidents.some((i) => i.incidentId === incident.incidentId);
      const incidents = known
        ? data.incidents.map((i) => (i.incidentId === incident.incidentId ? incident : i))
        : [...data.incidents, incident];
      return { ...data, incidents };
    }
    case "events":
      return data && { ...data, events: [...data.events, ...message.events] };
    case "pong":
      return data;
  }
}

export function openWatch(url: string, onChange: (view: WatchView) => void): { close(): void } {
  let view: WatchView = { connected: false, data: undefined };
  const update = (next: WatchView) => {
    view = next;
    onChange(view);
  };

  const socket = openReconnecting({
    url,
    onMessage: (message) => update({ ...view, data: receive(view.data, message as WatchMessage) }),
    onConnectedChange: (connected) => update({ ...view, connected }),
  });

  return { close: () => socket.close() };
}
