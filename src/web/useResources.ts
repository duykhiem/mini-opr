import { useEffect, useState } from "react";
import type { Resource } from "../shared/resource.ts";

// Resources come from the Coordinator over HTTP (ADR 0006).
export function useResources(): { resources: Resource[]; error?: string } {
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch("/api/resources")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Resource[]>;
      })
      .then(setResources, (e: unknown) => setError(`Could not load Resources: ${String(e)}`));
  }, []);

  return { resources, error };
}
