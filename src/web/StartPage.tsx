import { useResources } from "./useResources.ts";

export function StartPage() {
  const { resources, error } = useResources();

  return (
    <main>
      <h1>Mini OPR</h1>
      <ul>
        <li>
          <a href="/eoc" target="_blank" rel="noopener">EOC page</a>
        </li>
        {resources.map((r) => (
          <li key={r.resourceId}>
            <a href={`/device?resource=${encodeURIComponent(r.resourceId)}`} target="_blank" rel="noopener">
              Device: {r.name}
            </a>
          </li>
        ))}
        <li>
          <a href="/coordinator" target="_blank" rel="noopener">Coordinator page</a>
        </li>
      </ul>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
