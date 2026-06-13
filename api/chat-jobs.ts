import { waitUntil } from "@vercel/functions";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { createOrRetryChatJob, processChatJob, serializeChatJob } from "./lib/chat-jobs.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    clientOperationId,
    message,
    originalText,
    mermaidCode,
    chatHistory,
    canvasId,
    activeScopeId,
    scopePath,
  } = req.body || {};

  if (!clientOperationId || !message) {
    return res.status(400).json({ error: "clientOperationId and message are required" });
  }

  try {
    const job = await createOrRetryChatJob(authPayload.userId, String(clientOperationId), {
      message: String(message),
      originalText: String(originalText || message),
      mermaidCode: String(mermaidCode || "flowchart TD\n    A[Start]"),
      chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
      canvasId: canvasId || null,
      activeScopeId: activeScopeId || null,
      scopePath: Array.isArray(scopePath) ? scopePath : [],
    });

    if (job.status === "pending") {
      waitUntil(processChatJob(job.id));
    }

    return res.status(job.status === "completed" ? 200 : 202).json({ job: serializeChatJob(job) });
  } catch (err) {
    console.error("Create chat job error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to create chat job";
    return res.status(500).json({ error: errorMessage });
  }
}
