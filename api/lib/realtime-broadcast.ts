export type CanvasBroadcastEvent = "updated" | "deleted" | "commit";

const BROADCAST_TIMEOUT_MS = 2000;

// Notifies open canvas windows via Supabase Realtime's HTTP broadcast
// endpoint (no websocket needed server-side). Payloads are refetch hints
// only — never canvas content, since the channels are public. Never throws;
// a failed broadcast must not fail the write it follows.
export async function broadcastCanvasEvent(
  canvasId: string,
  event: CanvasBroadcastEvent,
  senderClientId?: string | null,
  extra?: Record<string, unknown>
): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !apiKey) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `canvas:${canvasId}`,
            event,
            payload: {
              canvasId,
              senderClientId: typeof senderClientId === "string" ? senderClientId : null,
              ...extra,
            },
            private: false,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Canvas broadcast failed (HTTP ${res.status}) for canvas ${canvasId}`);
    }
  } catch (err) {
    console.error("Canvas broadcast error:", err);
  } finally {
    clearTimeout(timeout);
  }
}
