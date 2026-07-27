import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";
import { decrypt } from "./lib/crypto.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "./lib/entitlements.js";
import OpenAI from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";

const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024;

const UPLOAD_ANALYSIS_INSTRUCTIONS = `You are IntelliDraw, an AI that analyzes a user's message together with an attached image or document to generate or update Mermaid flowcharts.

Follow the user's request as the primary instruction. Analyze the attachment as the source material. If the user explicitly asks to add to, compare with, or update the current diagram, use the supplied current Mermaid code as the starting point. Otherwise create a new comprehensive flowchart from the attachment.

ALWAYS output the complete Mermaid code in a fenced code block with the language identifier "mermaid".
Use descriptive node labels and proper flow connections.`;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".log": "text/plain",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".rtf": "application/rtf",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

const DOCUMENT_MIME_TYPES = new Set(Object.values(DOCUMENT_MIME_BY_EXTENSION));

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function normalizeBase64(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const commaIndex = trimmed.indexOf(",");
  return trimmed.startsWith("data:") && commaIndex >= 0
    ? trimmed.slice(commaIndex + 1).replace(/\s/g, "")
    : trimmed.replace(/\s/g, "");
}

function resolveMimeType(fileName: string, fileType: unknown): { kind: "image" | "document"; mimeType: string } | null {
  const declaredType = typeof fileType === "string" ? fileType.trim().toLowerCase() : "";
  const extension = getExtension(fileName);

  if (declaredType.startsWith("image/")) {
    return { kind: "image", mimeType: declaredType };
  }

  const imageMime = IMAGE_MIME_BY_EXTENSION[extension];
  if (imageMime) {
    return { kind: "image", mimeType: imageMime };
  }

  const documentMime = DOCUMENT_MIME_BY_EXTENSION[extension];
  if (documentMime) {
    return { kind: "document", mimeType: documentMime };
  }

  if (DOCUMENT_MIME_TYPES.has(declaredType)) {
    return { kind: "document", mimeType: declaredType };
  }

  return null;
}

function buildInputContent(args: {
  base64Data: string;
  fileName: string;
  kind: "image" | "document";
  mimeType: string;
  message: string;
  mermaidCode: string;
}): ResponseInputMessageContentList {
  const requestedAction = args.message.trim() || `Analyze this ${args.kind} and create a Mermaid flowchart that represents its content, structure, or workflow.`;
  const currentDiagram = args.mermaidCode.trim()
    ? `\n\nCURRENT MERMAID CODE:\n\`\`\`mermaid\n${args.mermaidCode.trim()}\n\`\`\``
    : "";
  const prompt = `The user attached ${args.kind === "image" ? "an image" : "a document"} named "${args.fileName}".

USER REQUEST:
${requestedAction}${currentDiagram}

Analyze the user's request and the attached file together. Only use the current diagram as a starting point when the user asks to update, extend, compare with, or integrate into it. Return the complete resulting Mermaid diagram.`;

  if (args.kind === "image") {
    return [
      { type: "input_text", text: prompt },
      {
        type: "input_image",
        image_url: `data:${args.mimeType};base64,${args.base64Data}`,
        detail: "auto",
      },
    ];
  }

  return [
    {
      type: "input_file",
      filename: args.fileName,
      file_data: `data:${args.mimeType};base64,${args.base64Data}`,
    },
    { type: "input_text", text: prompt },
  ];
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
    await requireFeatureQuota(authPayload.userId, "canvas.upload_file");

    // Get user's API key and active model
    const { data: user } = await supabase
      .from("users")
      .select("api_key_encrypted, active_model_id")
      .eq("id", authPayload.userId)
      .single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({
        error: "No API key configured. Please add your OpenAI API key in Settings.",
      });
    }

    const apiKey = decrypt(user.api_key_encrypted);

    // Get the active model ID
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase
        .from("ai_models")
        .select("model_id")
        .eq("id", user.active_model_id)
        .single();
      if (model) modelId = model.model_id;
    }

    // Parse the uploaded file from the request body (base64 encoded)
    const { fileData, fileName, fileType, message, mermaidCode: currentMermaidCode } = req.body;
    const normalizedFileData = normalizeBase64(fileData);
    const safeFileName = typeof fileName === "string" && fileName.trim()
      ? fileName.trim()
      : "uploaded-file";

    if (!normalizedFileData) {
      return res.status(400).json({ error: "No file data provided" });
    }

    const inputBytes = Buffer.byteLength(normalizedFileData, "base64");
    if (inputBytes > MAX_INPUT_FILE_BYTES) {
      return res.status(413).json({ error: "Uploaded file must be under 50 MB." });
    }

    const resolvedType = resolveMimeType(safeFileName, fileType);
    if (!resolvedType) {
      return res.status(415).json({
        error: "Unsupported file type. Upload an image, PDF, Word document, Markdown, or text-based file.",
      });
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: modelId,
      instructions: UPLOAD_ANALYSIS_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: buildInputContent({
            base64Data: normalizedFileData,
            fileName: safeFileName,
            kind: resolvedType.kind,
            mimeType: resolvedType.mimeType,
            message: typeof message === "string" ? message : "",
            mermaidCode: typeof currentMermaidCode === "string" ? currentMermaidCode : "",
          }),
        },
      ],
      max_output_tokens: 4096,
      temperature: modelId === "gpt-5.5" ? 1 : 0.7,
    });

    const aiResponse = response.output_text || "";

    // Extract mermaid code
    const mermaidMatch = aiResponse.match(/```mermaid\s*([\s\S]*?)```/i);
    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;
    await recordFeatureUsage(authPayload.userId, "canvas.upload_file", 1, {
      fileName: safeFileName,
      inputBytes,
      kind: resolvedType.kind,
      model: modelId,
      hasUserMessage: typeof message === "string" && message.trim().length > 0,
    });

    return res.status(200).json({
      response: aiResponse,
      mermaidCode,
      model: modelId,
    });
  } catch (err: unknown) {
    if (isEntitlementError(err)) return sendEntitlementError(res, err);
    console.error("Upload analysis error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to analyze file";
    return res.status(500).json({ error: errorMessage });
  }
}
