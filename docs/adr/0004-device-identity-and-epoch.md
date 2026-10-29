# One Device per Resource per browser, and a Coordinator epoch

A Device is one Resource in one browser: on first use the page makes a UUID and stores it in localStorage under `device:<resourceId>`, so reloads and new tabs reuse it, and a second browser on the same Resource is a separate Device. A tab holds the Web Lock `device:<resourceId>` while it is that Device, so only one tab per browser can be it. The Coordinator keeps a Coordinator epoch that changes on every Reset, and each Device clears itself when it sees a new one.

## Rules

- Choosing a Resource writes `?resource=` into the URL, so a reload reopens the same Device.
- A second tab that picks a Resource already open sees "Resource X is already open in another tab" and can pick another. It does not wait for the lock.
- Storage is localStorage. The Event log is under `opr:<deviceId>:events`; events received from the Coordinator are under `opr:<deviceId>:received` (see ADR 0005).
- The first message on every connection is `hello { deviceId, resourceId, epoch }`. If the stored epoch differs from the Coordinator's, the Device clears its stored events and epoch, keeps its `deviceId`, and starts empty. A plain Coordinator restart keeps the epoch.

## Considered options

- **An id per tab in sessionStorage:** "Duplicate tab" copies it, and a closed tab leaves its unsent events behind.
- **`deviceId = resourceId`:** merges Device and Resource, and two browsers would share one Offset.
- **IndexedDB:** async and needs a wrapper; demo data is small and the Web Lock already ensures one writer.
- **Re-uploading local events after a Reset:** would bring back events for Incidents that no longer exist.

Source: [Device identity and local storage across tabs](https://github.com/duykhiem/mini-opr/issues/6).
