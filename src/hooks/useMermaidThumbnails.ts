import { useState, useEffect } from "react";
import mermaid from "mermaid";
import { apiGetCanvasPreviewCodes } from "../lib/api";

// ─── Types ───────────────────────────────────────────────────────────
interface CanvasInfo {
  id: string;
  updated_at: string;
  mermaid_code?: string | null;
}

// ─── Cache helpers (localStorage, keyed by id::updated_at) ──────────
const CACHE_KEY = "intellidraw_thumb_cache";
const RENDER_DELAY_MS = 150; // yield between renders to keep UI smooth

function cacheId(id: string, updatedAt: string) {
  return `${id}::${updatedAt}`;
}

function loadCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistCache(cache: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded — clear stale data and move on
    console.warn("Thumbnail cache overflowed, clearing.");
    localStorage.removeItem(CACHE_KEY);
  }
}

function pruneStaleEntriesForCanvases(cache: Record<string, string>, canvases: CanvasInfo[]) {
  const currentKeys = new Set(canvases.map((c) => cacheId(c.id, c.updated_at)));
  const currentIds = new Set(canvases.map((c) => c.id));

  for (const key of Object.keys(cache)) {
    const [id] = key.split("::");
    if (currentIds.has(id) && !currentKeys.has(key)) {
      delete cache[key];
    }
  }
}

// Offset counter to avoid ID collisions with the full MermaidRenderer
let thumbCounter = 10_000;

// ─── Hook ────────────────────────────────────────────────────────────
/**
 * Renders mermaid-code thumbnails for a list of canvases.
 *
 * • Renders **one at a time** (mermaid's global state isn't concurrency-safe)
 *   with a small delay between each to keep the UI responsive.
 * • Caches SVG output in localStorage, keyed by `canvas.id :: canvas.updated_at`
 *   so edits automatically invalidate stale thumbnails.
 * • On unmount (e.g. user opens a canvas) the queue is cancelled.
 *   On re-mount the hook picks up where it left off — already-cached items
 *   are served instantly and only the remainder enters the queue.
 */
export function useMermaidThumbnails(canvases: CanvasInfo[]) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const isStaleRun = () => cancelled;

    // 1. Load cache & prune stale entries for this visible preview window.
    const raw = loadCache();
    pruneStaleEntriesForCanvases(raw, canvases);
    persistCache(raw);

    // 2. Split canvases into "already cached" vs "needs code/render"
    const initial: Record<string, string> = {};
    const queue: Array<CanvasInfo & { mermaid_code: string }> = [];
    const missingCode: CanvasInfo[] = [];

    for (const c of canvases) {
      const key = cacheId(c.id, c.updated_at);
      if (raw[key]) {
        initial[c.id] = raw[key];
      } else if (c.mermaid_code?.trim()) {
        queue.push({ ...c, mermaid_code: c.mermaid_code.trim() });
      } else {
        missingCode.push(c);
      }
    }

    // Serve cached thumbnails immediately (no flash of placeholder)
    setThumbnails(initial);

    // 3. Fetch code only for uncached thumbnails, then render sequentially.
    const processQueue = async () => {
      let renderQueue = queue;

      if (missingCode.length > 0) {
        try {
          const previewCodes = await apiGetCanvasPreviewCodes(missingCode.map((canvas) => canvas.id));
          const byId = new Map(previewCodes.map((canvas) => [canvas.id, canvas]));
          renderQueue = [
            ...renderQueue,
            ...missingCode.flatMap((canvas) => {
              const preview = byId.get(canvas.id);
              const code = preview?.mermaid_code?.trim();
              return code ? [{ ...canvas, mermaid_code: code }] : [];
            }),
          ];
        } catch (err) {
          console.warn("Thumbnail preview code fetch failed:", err);
        }
      }

      for (const canvas of renderQueue) {
        if (isStaleRun()) return;

        try {
          thumbCounter++;
          const { svg } = await mermaid.render(
            `thumb-${thumbCounter}`,
            canvas.mermaid_code
          );

          if (isStaleRun()) return;

          // Update React state so the card updates in real-time
          setThumbnails((prev) => ({ ...prev, [canvas.id]: svg }));

          // Persist to localStorage
          const cache = loadCache();
          cache[cacheId(canvas.id, canvas.updated_at)] = svg;
          persistCache(cache);
        } catch (err) {
          console.warn(
            `Thumbnail render failed for canvas ${canvas.id}:`,
            err
          );
          // Non-fatal — card will just keep showing the placeholder icon
        }

        // Yield to the browser so the UI never feels janky
        await new Promise((r) => setTimeout(r, RENDER_DELAY_MS));
      }
    };

    processQueue();

    // Cleanup: cancel on unmount (navigating away from dashboard)
    return () => {
      cancelled = true;
    };
  }, [canvases]);

  return thumbnails;
}
