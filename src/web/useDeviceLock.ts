import { useEffect, useState } from "react";
import { deviceKey } from "../shared/device.ts";

export type DeviceLock = "pending" | "held" | "taken";

// Only one tab per browser can be the Device of a Resource (ADR 0004).
// A tab that cannot get the Web Lock at once is told so; it does not wait.
export function useDeviceLock(resourceId: string | null): DeviceLock {
  const [lock, setLock] = useState<{ resourceId: string; status: DeviceLock } | null>(null);

  useEffect(() => {
    if (resourceId === null) return;
    let cancelled = false;
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));

    // Requested a tick later, so StrictMode's mount, unmount, mount does not take the lock
    // twice and report this tab's own lock as held by another tab.
    const timer = setTimeout(() => {
      navigator.locks.request(deviceKey(resourceId), { ifAvailable: true }, (granted) => {
        if (cancelled) return undefined;
        setLock({ resourceId, status: granted === null ? "taken" : "held" });
        return granted === null ? undefined : released;
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      release();
    };
  }, [resourceId]);

  // A result for another Resource is stale until the new request answers.
  return lock !== null && lock.resourceId === resourceId ? lock.status : "pending";
}
