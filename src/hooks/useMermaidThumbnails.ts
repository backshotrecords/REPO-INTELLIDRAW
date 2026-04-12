import { useState, useEffect, useRef } from "react";
import mermaid from "mermaid";

// ─── Types ───────────────────────────────────────────────────────────
interface CanvasInfo {
  id: string;
  mermaid_code: string;
  updated_at: string;
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
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // 1. Load cache & prune entries for deleted / updated canvases
    const raw = loadCache();
    const validKeys = new Set(
      canvases.map((c) => cacheId(c.id, c.updated_at))
    );
    const pruned: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (validKeys.has(k)) pruned[k] = v;
    }
    persistCache(pruned);

    // 2. Split canvases into "already cached" vs "needs render"
    const initial: Record<string, string> = {};
    const queue: CanvasInfo[] = [];

    for (const c of canvases) {
      const key = cacheId(c.id, c.updated_at);
      if (pruned[key]) {
        initial[c.id] = pruned[key];
      } else if (c.mermaid_code?.trim()) {
        queue.push(c);
      }
    }

    // Serve cached thumbnails immediately (no flash of placeholder)
    setThumbnails(initial);

    // 3. Process the render queue sequentially
    const processQueue = async () => {
      for (const canvas of queue) {
        if (cancelledRef.current) return;

        try {
          thumbCounter++;
          const { svg } = await mermaid.render(
            `thumb-${thumbCounter}`,
            canvas.mermaid_code.trim()
          );

          if (cancelledRef.current) return;

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
      cancelledRef.current = true;
    };
  }, [canvases]);

  return thumbnails;
}
