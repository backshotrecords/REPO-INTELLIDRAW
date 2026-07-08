import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient, realtimeClientId } from "../lib/supabase";

export type CanvasRealtimeEventType = "updated" | "deleted" | "commit";

export interface CanvasRealtimeEvent {
  type: CanvasRealtimeEventType;
  // True for synthetic events fired after a reconnect or tab refocus, where
  // broadcasts may have been missed and a refetch is the only way to catch up.
  catchUp?: boolean;
}

const DEBOUNCE_MS = 400;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

// Subscribes to the `canvas:<id>` Supabase Realtime broadcast channel and
// invokes onEvent for changes made by OTHER windows (own events are filtered
// out via realtimeClientId). Events are untrusted refetch hints: they carry
// no canvas content, so the handler must refetch through the authed API.
export function useCanvasRealtime(
  canvasId: string | null,
  onEvent: (event: CanvasRealtimeEvent) => void
) {
  // Keep the handler in a ref so the subscription only depends on canvasId.
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!canvasId) return;
    const client = getSupabaseClient();
    if (!client) return;

    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = RETRY_BASE_MS;
    let pendingType: "updated" | "commit" | null = null;
    let everSubscribed = false;

    const deliver = (event: CanvasRealtimeEvent) => {
      if (!disposed) onEventRef.current(event);
    };

    // Coalesce bursts (e.g. commit + save arriving together) into one event;
    // 'updated' supersedes 'commit' since it implies a full refetch anyway.
    const queueCoalesced = (type: "updated" | "commit") => {
      if (pendingType !== "updated") pendingType = type;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const type_ = pendingType;
        pendingType = null;
        if (type_) deliver({ type: type_ });
      }, DEBOUNCE_MS);
    };

    const handleBroadcast = (type: CanvasRealtimeEventType) =>
      (message: { payload?: { senderClientId?: string | null } }) => {
        if (message?.payload?.senderClientId === realtimeClientId) return;
        if (type === "deleted") deliver({ type: "deleted" });
        else queueCoalesced(type);
      };

    const scheduleResubscribe = () => {
      if (disposed || retryTimer) return;
      const stale = channel;
      channel = null;
      if (stale) void client.removeChannel(stale);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
        subscribe();
      }, retryDelayMs);
    };

    const subscribe = () => {
      if (disposed) return;
      channel = client
        .channel(`canvas:${canvasId}`)
        .on("broadcast", { event: "updated" }, handleBroadcast("updated"))
        .on("broadcast", { event: "commit" }, handleBroadcast("commit"))
        .on("broadcast", { event: "deleted" }, handleBroadcast("deleted"))
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            retryDelayMs = RETRY_BASE_MS;
            // Recovered after a drop — broadcasts may have been missed.
            if (everSubscribed) deliver({ type: "updated", catchUp: true });
            everSubscribed = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleResubscribe();
          }
        });
    };

    // Sleep / background-tab throttling can silently drop the socket; refetch
    // whenever the tab becomes visible again.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        deliver({ type: "updated", catchUp: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    subscribe();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) void client.removeChannel(channel);
    };
  }, [canvasId]);
}
