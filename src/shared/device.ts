// The localStorage key of the deviceId, and the name of the Web Lock (ADR 0004).
export function deviceKey(resourceId: string): string {
  return `device:${resourceId}`;
}
