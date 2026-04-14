import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";
import { decrypt } from "./lib/crypto.js";
import OpenAI from "openai";

/**
 * POST /api/transcribe
 *
 * Accepts a multipart/form-data upload with an "audio" field,
 * sends it to OpenAI Whisper, and returns the transcribed text.
 *
 * On Vercel, we cannot use multer/disk storage (read-only FS),
 * so we parse the multipart body manually using the Web API and
 * pass the audio buffer directly to the OpenAI SDK.
 */
export const config = {
  api: {
    bodyParser: false, // we need the raw body for multipart parsing
  },
};

/**
 * Collect raw body from the incoming request stream.
 */
function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Minimal multipart/form-data parser.
 * Extracts the first file field from the body.
 */
function parseMultipart(
  body: Buffer,
  contentType: string
): { filename: string; data: Buffer; mimeType: string } | null {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[1];
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  // Find parts
  const bodyStr = body.toString("binary");
  const parts = bodyStr.split(boundaryBuffer.toString("binary")).filter((p) => p.trim() && p.trim() !== "--");

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.substring(0, headerEnd);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (!filenameMatch) continue;

    const filename = filenameMatch[1];
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);
    const mimeType = contentTypeMatch ? contentTypeMatch[1].trim() : "audio/webm";

    // Extract binary data (skip headers + \r\n\r\n, trim trailing \r\n)
    const dataStart = headerEnd + 4;
    const dataEnd = part.endsWith("\r\n") ? part.length - 2 : part.length;
    const data = Buffer.from(part.substring(dataStart, dataEnd), "binary");

    return { filename, data, mimeType };
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Parse the multipart body
    const rawBody = await getRawBody(req);
    const contentType = req.headers["content-type"] || "";
    const filePart = parseMultipart(rawBody, contentType);

    if (!filePart) {
      return res.status(400).json({ error: "No audio file received." });
    }

    // Get user's API key
    const { data: user } = await supabase
      .from("users")
      .select("api_key_encrypted")
      .eq("id", authPayload.userId)
      .single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({
        error: "No API key configured. Please add your OpenAI API key in Settings.",
      });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    const openai = new OpenAI({ apiKey });

    // Create a File object from the buffer for the OpenAI SDK
    const audioFile = new File([filePart.data], filePart.filename, {
      type: filePart.mimeType,
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });

    return res.status(200).json({ text: transcription.text });
  } catch (err: unknown) {
    console.error("Transcription error:", err);
    const errorMessage = err instanceof Error ? err.message : "Transcription failed.";
    return res.status(500).json({ error: errorMessage });
  }
}
