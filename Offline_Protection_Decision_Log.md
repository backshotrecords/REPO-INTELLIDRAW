# Offline Protection Decision Log

Living feature spec for IntelliDraw's production offline/data-loss protection behavior.

## Scope

This feature is concerned with the Vercel production environment and serverless API functions. Do not design around the development server.

Primary goal: protect users from losing canvas, chat, transcription, upload, or save work when their internet connection drops.

## Core Product Principle

Offline handling is not only a warning. It is a safety system:

- Make the offline state obvious.
- Freeze risky interaction while offline.
- Preserve user work locally before crossing the network boundary.
- Resume or safely discard queued work based on explicit version rules.
- Avoid surprising server writes.

## Cache-First Operation Model

The core architecture is write-ahead local caching, not "check online before doing anything."

For every user-originated input or action that must cross the network boundary:

1. Capture the user's intent locally first.
2. Attempt the production/serverless API request.
3. Wait for an explicit success acknowledgement from the server.
4. Clear the local cached operation only after that acknowledgement, or after a safe stale/already-handled resolution.

This makes local durability the default path, not a special offline fallback.

The app should not depend on a pre-flight online check to protect user work. Browser online/offline state is useful for UI state and retry timing, but the data-loss protection comes from caching first and clearing only after receipt.

Use this mental model:

```txt
user input -> local durable cache -> network attempt -> server acknowledgement -> clear cache
```

If the network fails at any point before acknowledgement, the local operation remains available for retry or resolution.

## Connectivity Detection

Detection is active on the client and event-based toward the server.

Use browser connection state as the main detector:

```ts
window.addEventListener("offline", ...)
window.addEventListener("online", ...)
navigator.onLine
```

In addition, poll `navigator.onLine` on a short client-side timer (currently every 2 seconds) for as long as the app is open. This check never touches the network. It exists because the browser does not fire the `offline` event in every disconnect scenario (for example, upstream loss while the OS keeps its network interface up), and the offline UI must appear within seconds of a drop even when the user is idle.

A failed application API request is also a disconnect signal: the API layer throws a typed `NetworkError` and dispatches a global network-failure event whenever a request never reached the server. This drives the UI offline without waiting for browser events.

Do not continuously ping the production API on a timer.

Production reachability checks (one `GET /api/canvases` probe) run on these events:

- when the user clicks Retry connection
- when the browser fires the online event
- when the app opens and there is pending local work to recover
- automatically while the app is offline and the browser claims to be online, spaced at least 10 seconds apart — the app keeps trying to reconnect on its own for as long as it is open

Reason: continuous health polling would create unnecessary serverless load across many active users. The automatic reconnect probe only runs in the offline state and stops as soon as the app is back online.

Connectivity detection does not decide whether user input is worth caching. User input is cached first regardless. Connectivity detection decides when to freeze/unfreeze the UI and when to process pending operations.

## Offline UI

When offline:

- Show a thin red banner at the very top.
- Banner copy: `Offline - changes cannot be saved`
- Darken and blur the app body.
- Keep the offline banner visible and unblurred.
- Show a centered pill-style offline notice.
- Notice copy: `You're currently offline`
- Include a pill-shaped `Retry connection` button.
- Block interaction with the blurred app body.

When a reconnect attempt starts (Retry click, browser online event, or automatic retry):

- Do not show any success state yet.
- Show a neutral checking state: grey banner, copy `Checking connection...`, spinner in the pill.
- Keep the app body darkened, blurred, and blocked.
- Hide the Retry button while checking.

Only after the production reachability probe succeeds:

- Turn the banner green.
- Green banner copy: `Back online - syncing changes`
- Keep the app body darkened, blurred, and blocked while queued work resolves.
- Show reconnect progress messages in the overlay so the user can see each recovery state.
- Sync or resolve pending local work.
- Clear resolved local cache entries.
- Before unfreezing, re-check the connection; if it dropped again while the success message was showing, return to the offline state instead of unfreezing.
- Remove the banner and restore app interaction.

If the probe fails, return from the checking state straight to the red offline state.

Decision: never show the green/success state before reachability is verified. The earlier behavior — banner turned green and said `Back online` immediately on retry, then walked back to red on failure — is rejected as misleading.

## Action Blocking

The main action block is the visual freeze layer: the darkened and blurred app body should not accept clicks, keyboard sends, uploads, canvas moves, publishes, renames, or creates.

The freeze layer must block keyboard interaction, not just pointer input. Use the `inert` attribute on the blurred app body — `pointer-events: none` alone still allows Tab focus, typing, and Enter-to-submit inside the frozen UI.

Add lightweight code guards as backup for risky functions:

- chat send
- Enter-to-send
- voice auto-send
- autosave
- upload
- publish
- create canvas
- update canvas
- project moves
- title edits

These guards are secondary protection in case a function fires programmatically while the UI is frozen.

## Local Canvas Save Queue

If a canvas is open and a canvas-changing operation occurs, cache the current canvas state locally before attempting the server save.

Store one pending canvas save per canvas, keyed by `canvasId`.

Storage key:

```txt
intellidraw_pending_canvas_saves
```

Suggested entry shape:

```ts
{
  canvasId: string;
  localVersionNumber: number;
  baseServerVersionNumber: number;
  baseServerCommitId: string | null;
  mermaidCode: string;
  chatHistory: ChatMessage[];
  title: string;
  cachedAt: string;
}
```

If the same canvas changes again before acknowledgement, replace the pending entry with the newest local state.

## Version Authority

Use the Git Tree / canvas commit history as the version authority.

Current app behavior:

- Git Tree versions come from `canvas_commits`.
- Version numbers are effectively commit order: v1, v2, v3, etc.

Offline cache should store the version number it is based on and the next intended local version.

## Reconnect / App Open Sync

When the app opens with pending work, browser comes online, or user clicks Retry connection:

1. Check browser online state.
2. Confirm production API reachability only for that event.
3. Load pending local canvas saves.
4. Fetch current server commit/version state for each pending canvas.
5. Apply the version rules below.
6. Clear cache entries that are synced, stale, or already handled.

## Canvas Version Edge Cases

Agreed rules:

```txt
server v13, cache v14 -> sync cache as next version
server v14, cache v14 -> do nothing, treat as already handled, quietly clear cache
server v15, cache v14 -> discard cache as stale
server v13, cache v10 -> discard cache as stale
```

Server behind cache by exactly one version:

- The local cache represents the next unsynced change.
- Push cached canvas state to the server.
- Create the matching commit.
- Clear local cache.

Server equal to cache:

- Assume the cache was already synced but failed to clear.
- Do not sync.
- Do not overwrite.
- Do not show conflict.
- Quietly clear the cache.
- If the user later edits or sends something, the normal flow creates the next version.

Server ahead of cache:

- Treat cache as stale.
- Do not overwrite the server.
- Discard it, or preserve later as a recovery draft if we choose to add recovery UI.

Cache older than the server/base:

- Treat as stale.
- Do not sync.

## In-Flight Operation Protection

Offline protection must cover all network-bound operations, including operations that already started before the connection dropped. The operation is cached before the network request starts, then cleared only after server acknowledgement.

### Transcription Started, Then Connection Drops

Current risk: `VoiceMicButton` sends a blob to `/api/transcribe`. If the request fails, the blob is lost after the error.

Desired behavior:

- Before sending audio for transcription, store a local pending transcription operation.
- Include the audio blob, target canvas id, whether it was auto-send, and timestamps.
- If transcription succeeds and the client receives acknowledgement/text, clear the pending transcription operation.
- If transcription fails due to network loss, keep the operation queued.
- On reconnect, retry transcription.
- If retry succeeds:
  - if it was not auto-send, append the transcript to the chat input
  - if it was auto-send, continue into the queued chat-send flow

Suggested storage: IndexedDB, not localStorage, because audio blobs can be large and binary.

### Chat Send Started, Then Connection Drops Before LLM Returns

Current risk: `sendMessage` adds the user message and clears the input before `apiChat` returns. If the request fails mid-flight, the user intent is visible in chat history but not safely retried.

Desired behavior:

- Before calling `/api/chat`, store a pending chat operation.
- Include the original user text, augmented message, canvas id, Mermaid snapshot, chat history snapshot, scope path, active scope, and intended version metadata.
- If the LLM request succeeds and the client receives acknowledgement/response, clear the pending chat operation.
- If the request fails due to network loss, keep the operation queued.
- On reconnect, retry the pending chat operation.
- When retry succeeds, apply assistant response, updated Mermaid code, autosave, and commit creation through the normal flow.

Important: do not duplicate the visible user message on retry. The queued operation should know whether the user message has already been inserted into chat history.

### Canvas Save Started, Then Connection Drops Before Save Confirmation

Current risk: autosave calls `apiUpdateCanvas`. If the request leaves the browser but the response never returns, the client cannot know whether the server saved it.

Desired behavior:

- Cache the save before calling `apiUpdateCanvas`.
- Treat the save as pending until confirmed by server acknowledgement.
- Keep the latest local canvas snapshot in the pending canvas save queue.
- On reconnect, compare server version to cache version:
  - server behind by one: sync
  - server equal: treat as already handled and clear cache
  - server ahead: treat cache as stale

This protects both cases:

- request never reached the server
- request reached the server, but the response was lost

## Durable Operation Queue

Canvas saves, chat sends, transcriptions, and uploads should be represented as durable local operations. This queue is standard for network-bound user intent, not only for known-offline moments.

Suggested operation types:

```ts
type OfflineOperationType =
  | "canvas_save"
  | "chat_send"
  | "transcription"
  | "upload";
```

Suggested fields:

```ts
{
  id: string;
  type: OfflineOperationType;
  canvasId: string | null;
  status: "pending" | "in_flight" | "retrying";
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  payload: unknown;
}
```

Use localStorage for small JSON payloads and IndexedDB for blobs/files.

Queue processing should be conservative:

- process only after an online/retry event
- do not poll continuously
- process in creation order per canvas
- do not run multiple operations for the same canvas at the same time
- clear each operation only after confirmed success or safe stale-resolution
- keep the app frozen until queued work is synced, cleared, or safely discarded

Multi-tab safety: the queue lives in localStorage and is shared across tabs, so processing must be serialized — otherwise two tabs reconnecting at the same time both drain the same queue (duplicate chat sends and transcriptions), and unsynchronized read-modify-write can resurrect already-completed operations. Resolution: reconnect queue processing runs inside a Web Locks API request (`navigator.locks`, lock name `intellidraw-offline-queue`), so only one tab on the origin drains the queue at a time; the lock auto-releases if the holding tab closes or crashes. The connectivity provider also listens to the cross-tab `storage` event so every tab's pending count stays current when another tab changes the queue. Tabs without Web Locks support fall back to unserialized processing.

## Server Acknowledgement / Receipt

Every network-bound operation needs a clear receipt condition.

Examples:

- canvas save: `apiUpdateCanvas` returns the updated canvas and version state
- commit creation: `apiCreateCommit` returns the persisted commit
- chat send: `/api/chat` returns the assistant response and any updated Mermaid code
- transcription: `/api/transcribe` returns transcript text
- upload: `/api/upload` returns parsed response and optional Mermaid code

If the request may have reached the server but the client did not receive the response, keep the cached operation. On reconnect, use version rules or operation-specific checks to decide whether it already completed, should retry, or is stale.

## Resolved Product Decisions

- Stale cache entries should be discarded. Do not add recovery storage or bloat for stale entries.
- Pending chat operations should show visible status in chat history, such as `Waiting to retry...`, because the user should always know what is happening.
- Failed transcription retries should append the transcript to the input automatically when they eventually succeed.
- There is no maximum age that automatically requires user confirmation. The queued work must resolve before the user can interact with the app again after reconnect, no matter how long the device was offline.

## Reconnect Lock Rule

When the app returns online, do not immediately restore normal interaction.

Reconnect flow:

1. Keep the app darkened, blurred, and blocked.
2. Show the neutral `Checking connection...` state and verify production reachability.
3. Only on probe success, change the banner to the green reconnect/syncing state.
4. Show reconnect progress messages in the visible overlay.
5. Process queued work, including registered page-load retries.
6. Clear acknowledged, already-handled, or stale operations.
7. Re-check the connection state, then unfreeze the app.

This prevents old queued work from replaying after the user has resumed new activity, and prevents the app from unfreezing into a connection that has already dropped again.

## Failed Page Loads Recover on Reconnect

Read-path fetches (dashboard list, canvas open) are not queued as durable operations — they carry no user work — but they must self-heal:

- A page load that fails with `NetworkError` must not bounce the user to another page or show a modal alert. The connectivity overlay is the error surface for connection loss. Modal alerts and redirects remain correct for genuine server errors (for example, a deleted canvas).
- Each page registers a reconnect handler with the connectivity provider: the dashboard re-fetches its data; the workspace retries the canvas load that was pending when the connection dropped.
- After reconnect, the user must never be left looking at a stale `Failed to fetch` state once the overlay lifts.

## Reconnect UI Sequence

The reconnect process should have a visible sequence above the blurred app body. The user should never be left guessing whether the app is stuck or working.

Example states:

```txt
Checking connection...
Back online - checking saved work...
Syncing canvas changes...
Retrying pending message...
Restoring transcription...
Refreshing dashboard...
Reloading canvas...
Clearing completed queue...
All changes restored
```

The exact message should match the operation being processed. If there are no queued operations, the sequence can be short:

```txt
Checking connection...
Back online - checking saved work...
All changes restored
```

After the final state, remove the overlay, remove the banner, and return the app to normal.

## Implementation Checklist

- [x] Add shared durable offline operation storage.
- [x] Use localStorage for JSON queue metadata.
- [x] Use IndexedDB for blob payloads such as voice recordings.
- [x] Add global connectivity provider with browser online/offline handling and no server polling.
- [x] Poll `navigator.onLine` client-side so the offline UI appears within seconds of a drop, even when the user is idle and the offline event never fires.
- [x] Auto-attempt reconnection while the app is open, with server probes spaced at least 10 seconds apart.
- [x] Verify production reachability before showing any green/success state on reconnect (neutral `Checking connection...` state first).
- [x] Guard the go-online transition: re-check the connection before unfreezing in case it dropped during the success message.
- [x] Add red offline banner, green reconnect banner, blurred blocked app body, and retry overlay.
- [x] Block keyboard interaction with the frozen app body via the `inert` attribute.
- [x] Add typed `NetworkError` in the API layer to distinguish connection drops from server errors.
- [x] Re-fetch the dashboard and retry failed canvas loads on reconnect instead of leaving stale errors or alert/redirect bounces.
- [x] Add reconnect progress messages while queued work resolves.
- [x] Add cache-first canvas autosave handling.
- [x] Add cache-first chat send handling with visible `Waiting to retry...` chat state.
- [x] Add cache-first voice transcription handling that stores the recording before `/api/transcribe`.
- [x] Add reconnect queue processing for canvas saves, chat sends, and transcriptions.
- [x] Keep the app frozen until queued work resolves or safely fails closed.
- [ ] Extend cache-first protection to file uploads.
- [ ] Extend cache-first protection to publish/create/update/project actions outside the workspace send/save path.
- [x] Multi-tab safety: serialize queue processing across tabs with Web Locks and sync queue state via `storage` events.
- [ ] Add targeted automated tests for queue/version resolution.
- [x] Run production build verification.
