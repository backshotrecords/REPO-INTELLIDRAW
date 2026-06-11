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

Use browser connection state as the main detector:

```ts
window.addEventListener("offline", ...)
window.addEventListener("online", ...)
navigator.onLine
```

Do not continuously ping the production API on a timer.

Production reachability checks are event-based only:

- when the user clicks Retry connection
- when the browser fires the online event
- when the app opens and there is pending local work to recover

Reason: continuous health polling would create unnecessary serverless load across many active users.

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

When connection returns:

- Hide the offline notice.
- Turn the banner green briefly.
- Green banner copy can be `Back online - syncing changes`
- Keep the app body darkened, blurred, and blocked while queued work resolves.
- Show reconnect progress messages in the overlay so the user can see each recovery state.
- Sync or resolve pending local work.
- Clear resolved local cache entries.
- Remove the banner and restore app interaction.

## Action Blocking

The main action block is the visual freeze layer: the darkened and blurred app body should not accept clicks, keyboard sends, uploads, canvas moves, publishes, renames, or creates.

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
2. Change the banner to the green reconnect/syncing state.
3. Show reconnect progress messages in the visible overlay.
4. Process queued work.
5. Clear acknowledged, already-handled, or stale operations.
6. Only then unfreeze the app.

This prevents old queued work from replaying after the user has resumed new activity.

## Reconnect UI Sequence

The reconnect process should have a visible sequence above the blurred app body. The user should never be left guessing whether the app is stuck or working.

Example states:

```txt
Back online
Checking saved work...
Syncing canvas changes...
Retrying pending message...
Restoring transcription...
Clearing completed queue...
All changes restored
```

The exact message should match the operation being processed. If there are no queued operations, the sequence can be short:

```txt
Back online
Restoring workspace...
```

After the final state, remove the overlay, remove the banner, and return the app to normal.

## Implementation Checklist

- [x] Add shared durable offline operation storage.
- [x] Use localStorage for JSON queue metadata.
- [x] Use IndexedDB for blob payloads such as voice recordings.
- [x] Add global connectivity provider with browser online/offline handling and no polling.
- [x] Add red offline banner, green reconnect banner, blurred blocked app body, and retry overlay.
- [x] Add reconnect progress messages while queued work resolves.
- [x] Add cache-first canvas autosave handling.
- [x] Add cache-first chat send handling with visible `Waiting to retry...` chat state.
- [x] Add cache-first voice transcription handling that stores the recording before `/api/transcribe`.
- [x] Add reconnect queue processing for canvas saves, chat sends, and transcriptions.
- [x] Keep the app frozen until queued work resolves or safely fails closed.
- [ ] Extend cache-first protection to file uploads.
- [ ] Extend cache-first protection to publish/create/update/project actions outside the workspace send/save path.
- [ ] Add targeted automated tests for queue/version resolution.
- [x] Run production build verification.
