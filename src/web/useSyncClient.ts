import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createSyncClient, type SyncClient, type SyncState } from "../device/syncClient.ts";
import { deviceKey } from "../shared/device.ts";
import { deviceSocketPath } from "../shared/protocol.ts";

// One deviceId per Resource per browser, kept across reloads and tabs (ADR 0004).
function deviceIdFor(resourceId: string): string {
  const key = deviceKey(resourceId);
  const stored = localStorage.getItem(key);
  if (stored !== null) return stored;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${deviceSocketPath}`;
}

// Runs the Device sync client while this tab is the Device of the Resource.
export function useSyncClient(resourceId: string): { state: SyncState; join: SyncClient["join"] } {
  const client = useMemo(
    () =>
      createSyncClient({
        url: socketUrl(),
        deviceId: deviceIdFor(resourceId),
        resourceId,
        storage: localStorage,
        createSocket: (url) => new WebSocket(url),
      }),
    [resourceId],
  );

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  return { state: useSyncExternalStore(client.subscribe, client.getState), join: client.join };
}
