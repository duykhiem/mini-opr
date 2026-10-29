export function DevicePage({ resourceId }: { resourceId: string | null }) {
  return (
    <main>
      <h1>Device: {resourceId ?? "no Resource chosen"}</h1>
      <p>Not built yet.</p>
    </main>
  );
}
