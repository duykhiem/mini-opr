import { useEffect, useState } from "react";
import { openWatch, type WatchView } from "../shared/watchClient.ts";

// Live data from the Coordinator's read-only /watch socket (ADR 0008).
export function useWatch(): WatchView {
  const [view, setView] = useState<WatchView>({ connected: false, data: undefined });

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const client = openWatch(`${protocol}//${window.location.host}/watch`, setView);
    return () => client.close();
  }, []);

  return view;
}
