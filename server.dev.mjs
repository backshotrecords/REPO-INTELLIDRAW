import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import OpenAI from "openai";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ============================================================
// Config
// ============================================================
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const JWT_SECRET_STR = process.env.JWT_SECRET || "intellidraw-jwt-secret-change-in-prod";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STR);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "intellidraw-aes256-secret-key-change-in-prod";

// Mirrors api/lib/realtime-broadcast.ts (this file can't import the TS
// helper): notifies open canvas windows via Supabase Realtime broadcast.
async function broadcastCanvasEvent(canvasId, event, senderClientId, extra) {
  if (!supabaseUrl || !supabaseKey) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
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
    if (!res.ok) console.error(`Canvas broadcast failed (HTTP ${res.status}) for canvas ${canvasId}`);
  } catch (err) {
    console.error("Canvas broadcast error:", err);
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Crypto helpers
// ============================================================
function getKey() {
  return scryptSync(ENCRYPTION_KEY, "intellidraw-salt", 32);
}

function encrypt(text) {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const key = getKey();
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ============================================================
// Auth helpers
// ============================================================
async function createToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return verifyToken(authHeader.slice(7));
}

// Middleware
function requireAuth(handler) {
  return async (req, res) => {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    req.auth = auth;
    return handler(req, res);
  };
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post("/api/auth/register", async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Email, password, and display name are required" });
  }

  try {
    const { data: existing } = await supabase
      .from("users").select("id").eq("email", email.toLowerCase()).single();
    if (existing) return res.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase
      .from("users")
      .insert({ email: email.toLowerCase(), password_hash: passwordHash, display_name: displayName })
      .select("id, email, display_name")
      .single();

    if (error) { console.error("Register error:", error); return res.status(500).json({ error: "Failed to create account" }); }

    const token = await createToken({ userId: user.id, email: user.email });

    // Create default model
    await supabase.from("ai_models").insert({ user_id: user.id, model_id: "gpt-4o", label: "GPT-4o" });

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_hash, display_name, active_model_id, is_global_admin")
      .eq("email", email.toLowerCase())
      .single();

    if (error || !user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = await createToken({ userId: user.id, email: user.email });
    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name, activeModelId: user.active_model_id, isGlobalAdmin: user.is_global_admin },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/me", requireAuth(async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, display_name, active_model_id, api_key_encrypted, is_global_admin")
      .eq("id", req.auth.userId)
      .single();

    if (error || !user) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({
      user: {
        id: user.id, email: user.email, displayName: user.display_name,
        activeModelId: user.active_model_id, hasApiKey: !!user.api_key_encrypted, isGlobalAdmin: user.is_global_admin,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// PREVIEW ROUTE
// ============================================================
app.get("/api/preview", async (req, res) => {
  const { id } = req.query;

  let htmlPath = path.join(process.cwd(), "dist", "index.html");
  if (!fs.existsSync(htmlPath)) {
    htmlPath = path.join(process.cwd(), "index.html");
  }

  if (!fs.existsSync(htmlPath)) {
    return res.status(500).send("Index HTML not found");
  }

  let html = fs.readFileSync(htmlPath, "utf-8");

  if (!id || typeof id !== "string") {
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  }

  let protocol = req.protocol || "http";
  const host = req.get("host") || "localhost:3001";

  let title = "IntelliDraw Canvas";
  let imageUrl = `${protocol}://${host}/favicon.svg`; 
  let description = "View this flowchart created with IntelliDraw, the AI flowchart generator.";

  try {
    const { data: canvas } = await supabase
      .from("canvases")
      .select("title, mermaid_code, is_public")
      .eq("id", id)
      .eq("is_public", true)
      .single();

    if (canvas) {
      title = `${canvas.title} - IntelliDraw`;
      const state = { code: canvas.mermaid_code, mermaid: { theme: "default" } };
      const base64 = Buffer.from(JSON.stringify(state)).toString("base64");
      imageUrl = `https://mermaid.ink/img/${base64}`;
    }
  } catch (err) {
    console.error("Local preview fetching error:", err);
  }

  const tagsToInject = `
  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />
  <meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:type" content="website" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:title" content="${title.replace(/"/g, '&quot;')}" />
  <meta property="twitter:description" content="${description.replace(/"/g, '&quot;')}" />
  <meta property="twitter:image" content="${imageUrl}" />
`;

  html = html.replace("</head>", `${tagsToInject}\n</head>`);

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
});

// ============================================================
// CANVAS ROUTES
// ============================================================
app.get("/api/canvases", requireAuth(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("canvases")
      .select("id, title, mermaid_code, created_at, updated_at")
      .eq("user_id", req.auth.userId)
      .order("updated_at", { ascending: false });

    if (error) return res.status(500).json({ error: "Failed to fetch canvases" });
    return res.status(200).json({ canvases: data || [] });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.post("/api/canvases", requireAuth(async (req, res) => {
  const { title, mermaidCode } = req.body || {};
  try {
    const { data, error } = await supabase
      .from("canvases")
      .insert({
        user_id: req.auth.userId,
        title: title || "Untitled Canvas",
        mermaid_code: mermaidCode || "flowchart TD\n    A[Start] --> B[Next Step]",
        chat_history: [],
      })
      .select("id, title, mermaid_code, chat_history, created_at, updated_at")
      .single();

    if (error) { console.error("Create canvas error:", error); return res.status(500).json({ error: "Failed to create canvas" }); }
    return res.status(201).json({ canvas: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.get("/api/canvases/:id", requireAuth(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("canvases").select("*")
      .eq("id", req.params.id).eq("user_id", req.auth.userId).single();

    if (error || !data) return res.status(404).json({ error: "Canvas not found" });
    return res.status(200).json({ canvas: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.put("/api/canvases/:id", requireAuth(async (req, res) => {
  const { title, mermaidCode, chatHistory, senderClientId } = req.body || {};
  try {
    const updateData = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (mermaidCode !== undefined) updateData.mermaid_code = mermaidCode;
    if (chatHistory !== undefined) updateData.chat_history = chatHistory;

    const { data, error } = await supabase
      .from("canvases").update(updateData)
      .eq("id", req.params.id).eq("user_id", req.auth.userId)
      .select("*").single();

    if (error || !data) return res.status(404).json({ error: "Canvas not found or update failed" });
    await broadcastCanvasEvent(req.params.id, "updated", senderClientId, { updatedAt: updateData.updated_at });
    return res.status(200).json({ canvas: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.delete("/api/canvases/:id", requireAuth(async (req, res) => {
  try {
    const { error } = await supabase
      .from("canvases").delete()
      .eq("id", req.params.id).eq("user_id", req.auth.userId);

    if (error) return res.status(500).json({ error: "Failed to delete canvas" });
    await broadcastCanvasEvent(req.params.id, "deleted");
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// CANVAS SUGGEST NAME (AI auto-naming)
// ============================================================
app.post("/api/canvases/suggest-name", requireAuth(async (req, res) => {
  const { mermaidCode } = req.body || {};
  if (!mermaidCode) return res.status(400).json({ error: "mermaidCode is required" });

  try {
    const { data: user } = await supabase
      .from("users").select("api_key_encrypted, active_model_id")
      .eq("id", req.auth.userId).single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({ error: "No API key configured." });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
      if (model) modelId = model.model_id;
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: modelId,
      messages: [
        {
          role: "system",
          content: "You are a naming assistant. Given a Mermaid flowchart, suggest a short, descriptive title (3–6 words max). Reply with ONLY the title text — no quotes, no punctuation, no explanation.",
        },
        {
          role: "user",
          content: `Suggest a title for this flowchart:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_tokens: 100,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content || "Untitled Canvas";
    const suggestedName = raw.replace(/^["']+|["']+$/g, "").trim() || "Untitled Canvas";

    return res.status(200).json({ suggestedName });
  } catch (err) {
    console.error("Suggest name error:", err);
    return res.status(500).json({ error: err.message || "Failed to suggest name" });
  }
}));

// ============================================================
// CHAT ROUTE
// ============================================================
app.post("/api/chat", requireAuth(async (req, res) => {
  const { message, mermaidCode, chatHistory, canvasId } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  try {
    const { data: user } = await supabase
      .from("users").select("api_key_encrypted, active_model_id")
      .eq("id", req.auth.userId).single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({ error: "No API key configured. Please add your OpenAI API key in Settings." });
    }

    const apiKey = decrypt(user.api_key_encrypted);

    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
      if (model) modelId = model.model_id;
    }

    const openai = new OpenAI({ apiKey });

    // Fetch active skill notes for this canvas
    let skillInstructions = "";
    if (canvasId) {
      try {
        const { data: activeSkills } = await supabase.from("skill_note_attachments")
          .select("skill_notes(title, instruction_text)")
          .eq("user_id", req.auth.userId).eq("is_active", true).eq("trigger_mode", "automatic")
          .or(`canvas_id.eq.${canvasId},scope.eq.global`);
        const skills = (activeSkills || []).filter(d => d.skill_notes);
        if (skills.length > 0) {
          skillInstructions = "\n\nACTIVE SKILL NOTES (follow these as additional instructions and preferences):\n" +
            skills.map((s, i) => `--- Skill ${i + 1}: ${s.skill_notes.title} ---\n${s.skill_notes.instruction_text}`).join("\n\n");
        }
      } catch (skillErr) { console.error("Skill fetch error (non-fatal):", skillErr); }
    }

    const messages = [
      {
        role: "system",
        content: `You are IntelliDraw, an AI assistant that helps users create and refine Mermaid flowcharts through natural conversation.

CURRENT MERMAID CODE:
\`\`\`mermaid
${mermaidCode || "flowchart TD\n    A[Start]"}
\`\`\`

INSTRUCTIONS:
1. Respond conversationally to the user's request
2. When you need to update the flowchart, include the COMPLETE updated Mermaid code in a fenced code block with the language identifier "mermaid"
3. Always output the FULL mermaid code, not just the changes
4. Use valid Mermaid syntax (flowchart TD, graph LR, etc.)
5. Keep your conversational response concise but helpful
6. If the user asks for changes, apply them and show the updated code
7. Use descriptive node labels and proper flow connections${skillInstructions}`,
      },
    ];

    const history = Array.isArray(chatHistory) ? chatHistory.slice(-20) : [];
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: modelId, messages, max_tokens: 4096, temperature: 0.7,
    });

    const aiResponse = completion.choices[0]?.message?.content || "I couldn't generate a response.";
    const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
    const updatedMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    return res.status(200).json({ response: aiResponse, updatedMermaidCode, model: modelId });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: err.message || "Failed to get AI response" });
  }
}));

// ============================================================
// UPLOAD ROUTE
// ============================================================
app.post("/api/upload", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users").select("api_key_encrypted, active_model_id")
      .eq("id", req.auth.userId).single();

    if (!user?.api_key_encrypted) {
      return res.status(400).json({ error: "No API key configured." });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
      if (model) modelId = model.model_id;
    }

    const { fileData, fileName, fileType } = req.body;
    if (!fileData) return res.status(400).json({ error: "No file data provided" });

    const openai = new OpenAI({ apiKey });
    const isImage = fileType?.startsWith("image/");
    let aiResponse;

    if (isImage) {
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: "You are IntelliDraw, an AI that analyzes images and documents to generate Mermaid flowcharts. ALWAYS output the complete Mermaid code in a fenced code block with the language identifier \"mermaid\"." },
          { role: "user", content: [
            { type: "text", text: `Analyze this file "${fileName}" and create a Mermaid flowchart.` },
            { type: "image_url", image_url: { url: `data:${fileType};base64,${fileData}` } },
          ]},
        ],
        max_tokens: 4096,
      });
      aiResponse = completion.choices[0]?.message?.content || "";
    } else {
      const textContent = Buffer.from(fileData, "base64").toString("utf-8");
      const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: "You are IntelliDraw, an AI that analyzes documents to generate Mermaid flowcharts. ALWAYS output the complete Mermaid code in a fenced code block with the language identifier \"mermaid\"." },
          { role: "user", content: `Analyze this document "${fileName}" and create a Mermaid flowchart:\n\n${textContent.slice(0, 8000)}` },
        ],
        max_tokens: 4096,
      });
      aiResponse = completion.choices[0]?.message?.content || "";
    }

    const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
    return res.status(200).json({ response: aiResponse, mermaidCode: mermaidMatch ? mermaidMatch[1].trim() : null, model: modelId });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: err.message || "Failed to analyze file" });
  }
}));

// ============================================================
// SETTINGS ROUTES
// ============================================================
app.get("/api/settings", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase
      .from("users").select("id, email, display_name, api_key_encrypted, api_key_source, active_model_id")
      .eq("id", req.auth.userId).single();

    if (!user) return res.status(404).json({ error: "User not found" });

    let maskedKey = null;
    if (user.api_key_encrypted) {
      try {
        const rawKey = decrypt(user.api_key_encrypted);
        maskedKey = rawKey.length > 11
          ? rawKey.slice(0, 7) + "•".repeat(rawKey.length - 11) + rawKey.slice(-4)
          : "•".repeat(rawKey.length);
      } catch { maskedKey = "••••••••••••"; }
    }

    return res.status(200).json({
      user: {
        id: user.id, email: user.email, displayName: user.display_name,
        activeModelId: user.active_model_id,
        hasApiKey: !!user.api_key_encrypted,
        apiKeySource: user.api_key_source || "user",
        apiKeyManagedByAdmin: user.api_key_source === "admin",
        maskedApiKey: maskedKey,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.put("/api/settings", requireAuth(async (req, res) => {
  const { displayName, email } = req.body || {};
  try {
    const updateData = {};
    if (displayName !== undefined) updateData.display_name = displayName;
    if (email !== undefined) updateData.email = email.toLowerCase();

    const { data, error } = await supabase
      .from("users").update(updateData).eq("id", req.auth.userId)
      .select("id, email, display_name").single();

    if (error) return res.status(500).json({ error: "Failed to update profile" });
    return res.status(200).json({ user: { id: data.id, email: data.email, displayName: data.display_name } });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// API Key
app.put("/api/settings/apikey", requireAuth(async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "API key is required" });
  try {
    const encryptedKey = encrypt(apiKey);
    const { error } = await supabase.from("users").update({
      api_key_encrypted: encryptedKey,
      api_key_source: "user",
      api_key_updated_at: new Date().toISOString(),
      api_key_managed_by: null,
    }).eq("id", req.auth.userId);
    if (error) return res.status(500).json({ error: "Failed to save API key" });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.get("/api/settings/apikey", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("api_key_encrypted, api_key_source").eq("id", req.auth.userId).single();
    if (!user?.api_key_encrypted) return res.status(200).json({ apiKey: null });
    if (user.api_key_source === "admin") {
      return res.status(403).json({
        error: "This API key is managed by an administrator and cannot be revealed.",
        managedByAdmin: true,
      });
    }
    return res.status(200).json({ apiKey: decrypt(user.api_key_encrypted) });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// Test Connection
app.post("/api/settings/test-connection", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("api_key_encrypted").eq("id", req.auth.userId).single();
    if (!user?.api_key_encrypted) return res.status(200).json({ connected: false, message: "No API key configured" });

    const apiKey = decrypt(user.api_key_encrypted);
    const openai = new OpenAI({ apiKey });
    const models = await openai.models.list();
    const modelList = [];
    for await (const model of models) { modelList.push(model.id); if (modelList.length >= 5) break; }

    return res.status(200).json({ connected: true, message: `Successfully connected. ${modelList.length} models available.` });
  } catch (err) {
    return res.status(200).json({ connected: false, message: err.message || "Connection failed" });
  }
}));

// Models
app.get("/api/settings/models", requireAuth(async (req, res) => {
  try {
    const { data: models } = await supabase
      .from("ai_models").select("id, model_id, label, added_at")
      .eq("user_id", req.auth.userId).order("added_at", { ascending: true });

    const { data: user } = await supabase.from("users").select("active_model_id").eq("id", req.auth.userId).single();

    return res.status(200).json({ models: models || [], activeModelId: user?.active_model_id || null });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.post("/api/settings/models", requireAuth(async (req, res) => {
  const { modelId, label } = req.body || {};
  if (!modelId) return res.status(400).json({ error: "Model ID is required" });

  try {
    const { data, error } = await supabase.from("ai_models")
      .insert({ user_id: req.auth.userId, model_id: modelId, label: label || modelId })
      .select("id, model_id, label, added_at").single();

    if (error) return res.status(500).json({ error: "Failed to add model" });

    const { data: user } = await supabase.from("users").select("active_model_id").eq("id", req.auth.userId).single();
    if (!user?.active_model_id) {
      await supabase.from("users").update({ active_model_id: data.id }).eq("id", req.auth.userId);
    }

    return res.status(201).json({ model: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.delete("/api/settings/models", requireAuth(async (req, res) => {
  const modelDbId = req.query.modelId;
  if (!modelDbId) return res.status(400).json({ error: "Model ID is required" });

  try {
    const { data: user } = await supabase.from("users").select("active_model_id").eq("id", req.auth.userId).single();
    if (user?.active_model_id === modelDbId) {
      await supabase.from("users").update({ active_model_id: null }).eq("id", req.auth.userId);
    }

    await supabase.from("ai_models").delete().eq("id", modelDbId).eq("user_id", req.auth.userId);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.put("/api/settings/models", requireAuth(async (req, res) => {
  const { modelId: activeModelId } = req.body || {};
  try {
    await supabase.from("users").update({ active_model_id: activeModelId }).eq("id", req.auth.userId);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// Password Change & Verification
app.post("/api/settings/change-password", requireAuth(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }
  try {
    const { data: user, error: fetchError } = await supabase
      .from("users").select("id, password_hash")
      .eq("id", req.auth.userId).single();
    if (fetchError || !user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabase
      .from("users").update({ password_hash: newHash })
      .eq("id", req.auth.userId);
    if (updateError) return res.status(500).json({ error: "Failed to update password" });

    return res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("Change-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.post("/api/settings/verify-password", requireAuth(async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password is required" });
  try {
    const { data: user, error } = await supabase
      .from("users").select("password_hash")
      .eq("id", req.auth.userId).single();
    if (error || !user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password_hash);
    return res.status(200).json({ valid });
  } catch (err) {
    console.error("Verify-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// ACTIVE RULES (public for auto-fix)
// ============================================================
app.get("/api/rules_active", requireAuth(async (req, res) => {
  try {
    const { data, error } = await supabase.from("sanitization_rules").select("rule_description").eq("is_active", true);
    if (error) return res.status(500).json({ error: "Failed to fetch rules" });
    const descriptions = (data || []).map((r) => r.rule_description);
    return res.status(200).json({ rules: descriptions });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// ADMIN RULES ROUTES
// ============================================================
async function requireGlobalAdmin(req, res) {
  const { data: user } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", req.auth.userId)
    .single();
  if (!user?.is_global_admin) {
    res.status(403).json({ error: "Forbidden: Admins only" });
    return false;
  }
  return true;
}

async function cascadeDeleteUser(userId) {
  const { data: targetUser, error: lookupError } = await supabase
    .from("users")
    .select("id, email, display_name")
    .eq("id", userId)
    .single();
  if (lookupError || !targetUser) throw new Error("User not found");

  const { data: userSkills } = await supabase.from("skill_notes").select("id").eq("owner_id", userId);
  const skillIds = (userSkills || []).map((s) => s.id);
  if (skillIds.length > 0) {
    await supabase.from("skill_note_attachments").delete().in("skill_note_id", skillIds);
    await supabase.from("skill_note_shares").delete().in("skill_note_id", skillIds);
  }

  const { data: userCanvases } = await supabase.from("canvases").select("id").eq("user_id", userId);
  const canvasIds = (userCanvases || []).map((c) => c.id);
  if (canvasIds.length > 0) {
    await supabase.from("skill_note_attachments").delete().in("canvas_id", canvasIds);
    await supabase.from("canvas_commits").delete().in("canvas_id", canvasIds);
  }

  if (skillIds.length > 0) await supabase.from("skill_notes").delete().eq("owner_id", userId);
  await supabase.from("canvases").delete().eq("user_id", userId);
  await supabase.from("group_members").delete().eq("user_id", userId);

  const { data: ownedGroups } = await supabase.from("user_groups").select("id").eq("owner_id", userId);
  const groupIds = (ownedGroups || []).map((g) => g.id);
  if (groupIds.length > 0) {
    await supabase.from("group_members").delete().in("group_id", groupIds);
    await supabase.from("user_groups").delete().eq("owner_id", userId);
  }

  await supabase.from("user_onboarding_state").delete().eq("user_id", userId);
  await supabase.from("ai_models").delete().eq("user_id", userId);
  await supabase.from("skill_note_shares").delete().eq("shared_with_user_id", userId);

  const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);
  if (deleteError) throw new Error(deleteError.message || "Failed to delete user");

  return { deleted_email: targetUser.email, deleted_name: targetUser.display_name || "" };
}

app.get("/api/admin/users", requireAuth(async (req, res) => {
  try {
    if (!(await requireGlobalAdmin(req, res))) return;

    const { data: users, error } = await supabase
      .from("users")
      .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_encrypted, api_key_source")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message || "Failed to fetch users" });

    const { data: canvases } = await supabase.from("canvases").select("user_id");
    const canvasCounts = {};
    for (const c of canvases || []) {
      canvasCounts[c.user_id] = (canvasCounts[c.user_id] || 0) + 1;
    }

    const usersWithCounts = (users || []).map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      is_banned: u.is_banned,
      is_global_admin: u.is_global_admin,
      created_at: u.created_at,
      api_key_source: u.api_key_source || "user",
      has_api_key: !!u.api_key_encrypted,
      canvas_count: canvasCounts[u.id] || 0,
    }));

    return res.status(200).json({ users: usersWithCounts });
  } catch (err) {
    console.error("Admin users GET error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}));

app.put("/api/admin/users", requireAuth(async (req, res) => {
  try {
    if (!(await requireGlobalAdmin(req, res))) return;

    const { userId, is_banned } = req.body || {};
    if (!userId || typeof is_banned !== "boolean") {
      return res.status(400).json({ error: "userId and is_banned (boolean) are required" });
    }
    if (userId === req.auth.userId) return res.status(400).json({ error: "Cannot modify your own account" });

    const { error } = await supabase.from("users").update({ is_banned }).eq("id", userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to update user" });
    return res.status(200).json({ success: true, is_banned });
  } catch (err) {
    console.error("Admin users PUT error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}));

app.delete("/api/admin/users", requireAuth(async (req, res) => {
  try {
    if (!(await requireGlobalAdmin(req, res))) return;

    const userId = req.query.userId || req.body?.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (userId === req.auth.userId) return res.status(400).json({ error: "Cannot delete your own account" });

    const result = await cascadeDeleteUser(userId);
    return res.status(200).json({ success: true, deleted_email: result.deleted_email });
  } catch (err) {
    console.error("Admin users DELETE error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}));

app.put("/api/admin/users/:userId/apikey", requireAuth(async (req, res) => {
  try {
    if (!(await requireGlobalAdmin(req, res))) return;

    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Missing target user id" });
    if (userId === req.auth.userId) return res.status(400).json({ error: "Use Settings to manage your own API key" });

    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "API key is required" });
    }

    const encryptedKey = encrypt(apiKey.trim());
    const { data: user, error } = await supabase
      .from("users")
      .update({
        api_key_encrypted: encryptedKey,
        api_key_source: "admin",
        api_key_updated_at: new Date().toISOString(),
        api_key_managed_by: req.auth.userId,
      })
      .eq("id", userId)
      .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_source")
      .single();

    if (error) return res.status(500).json({ error: error.message || "Failed to save API key" });
    return res.status(200).json({ success: true, user: { ...user, has_api_key: true } });
  } catch (err) {
    console.error("Admin API key save error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}));

app.get("/api/admin/rules", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { data, error } = await supabase.from("sanitization_rules").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: "Failed to fetch rules" });
    return res.status(200).json({ rules: data || [] });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.post("/api/admin/rules", requireAuth(async (req, res) => {
  const { rule_description, is_active } = req.body;
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { data, error } = await supabase.from("sanitization_rules").insert({
      rule_description,
      is_active: is_active !== undefined ? is_active : true
    }).select("*").single();

    if (error) return res.status(500).json({ error: "Failed to create rule" });
    return res.status(201).json({ rule: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.put("/api/admin/rules/:id", requireAuth(async (req, res) => {
  const { is_active } = req.body;
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { data, error } = await supabase.from("sanitization_rules").update({ is_active }).eq("id", req.params.id).select("*").single();
    if (error) return res.status(500).json({ error: "Failed to update rule" });
    return res.status(200).json({ rule: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.delete("/api/admin/rules/:id", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { error } = await supabase.from("sanitization_rules").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: "Failed to delete rule" });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// ADMIN SOUND CONFIG (Supabase-backed)
// ============================================================


// Helper: read a config value from admin_config table
async function getAdminConfig(key, fallback = null) {
  const { data } = await supabase.from("admin_config").select("value").eq("key", key).single();
  return data ? data.value : fallback;
}

// Helper: upsert a config value
async function setAdminConfig(key, value) {
  const { error } = await supabase.from("admin_config").upsert({ key, value: String(value) }, { onConflict: "key" });
  if (error) {
    console.error(`setAdminConfig("${key}") failed:`, error.message);
    throw new Error(`Config save failed: ${error.message}`);
  }
}

// GET — any authenticated user can read the sound config
app.get("/api/admin/sound-config", requireAuth(async (_req, res) => {
  try {
    const { data: rows } = await supabase.from("admin_config").select("key, value").in("key", [
      "sound_volume", "sound_enabled",
      "sound_url", "sound_file_name",
      "voice_sound_url", "voice_sound_file_name"
    ]);

    const cfg = {};
    for (const row of (rows || [])) cfg[row.key] = row.value;

    return res.json({
      volume: parseFloat(cfg.sound_volume ?? "0.5"),
      enabled: (cfg.sound_enabled ?? "true") === "true",
      soundUrl: cfg.sound_url ?? "/intellidraw-v2.mp3",
      soundFileName: cfg.sound_file_name || null,
      voiceSoundUrl: cfg.voice_sound_url ?? "/intellisend_v2.mp3",
      voiceSoundFileName: cfg.voice_sound_file_name || null,
    });
  } catch (err) {
    console.error("Sound config GET error:", err);
    return res.status(500).json({ error: "Failed to load sound config" });
  }
}));

// PUT — admin-only: update volume / enabled / upload new sound
// Accepts JSON body with optional base64-encoded sound file
app.put("/api/admin/sound-config", requireAuth(async (req, res) => {
  try {
    // Admin check
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { volume, enabled, resetToDefault, soundType, soundFileData, soundFileName, soundFileMime } = req.body || {};
    const isVoice = soundType === "voice";
    const urlKey = isVoice ? "voice_sound_url" : "sound_url";
    const nameKey = isVoice ? "voice_sound_file_name" : "sound_file_name";
    const defaultUrl = isVoice ? "/intellisend_v2.mp3" : "/intellidraw-v2.mp3";

    if (volume !== undefined) await setAdminConfig("sound_volume", volume);
    if (enabled !== undefined) await setAdminConfig("sound_enabled", enabled);

    // Handle uploaded sound file (base64) → Supabase Storage
    if (soundFileData) {
      const oldUrl = await getAdminConfig(urlKey, defaultUrl);
      if (oldUrl && oldUrl.includes("/sound-effects/")) {
        const oldFileName = oldUrl.split("/sound-effects/").pop();
        if (oldFileName) await supabase.storage.from("sound-effects").remove([oldFileName]);
      }

      const ext = soundFileName?.match(/\.[^.]+$/)?.[0] || ".mp3";
      const storagePath = `custom-${isVoice ? "voice" : "canvas"}-${Date.now()}${ext}`;
      const buffer = Buffer.from(soundFileData, "base64");

      const { error: uploadErr } = await supabase.storage
        .from("sound-effects")
        .upload(storagePath, buffer, {
          contentType: soundFileMime || "audio/mpeg",
          upsert: true,
        });

      if (uploadErr) {
        console.error("Storage upload error:", uploadErr);
        return res.status(500).json({ error: "Failed to upload sound file" });
      }

      const { data: publicUrlData } = supabase.storage.from("sound-effects").getPublicUrl(storagePath);
      await setAdminConfig(urlKey, publicUrlData.publicUrl);
      await setAdminConfig(nameKey, soundFileName || "Custom Sound");
    }

    // Reset to bundled default
    if (resetToDefault === "true" || resetToDefault === true) {
      const oldUrl = await getAdminConfig(urlKey, defaultUrl);
      if (oldUrl && oldUrl.includes("/sound-effects/")) {
        const oldFileName = oldUrl.split("/sound-effects/").pop();
        if (oldFileName) await supabase.storage.from("sound-effects").remove([oldFileName]);
      }
      await setAdminConfig(urlKey, defaultUrl);
      await setAdminConfig(nameKey, "");
    }

    // Return updated config (all keys)
    const { data: rows } = await supabase.from("admin_config").select("key, value").in("key", [
      "sound_volume", "sound_enabled",
      "sound_url", "sound_file_name",
      "voice_sound_url", "voice_sound_file_name"
    ]);
    const cfg = {};
    for (const row of (rows || [])) cfg[row.key] = row.value;

    return res.json({
      volume: parseFloat(cfg.sound_volume ?? "0.5"),
      enabled: (cfg.sound_enabled ?? "true") === "true",
      soundUrl: cfg.sound_url ?? "/intellidraw-v2.mp3",
      soundFileName: cfg.sound_file_name || null,
      voiceSoundUrl: cfg.voice_sound_url ?? "/intellisend_v2.mp3",
      voiceSoundFileName: cfg.voice_sound_file_name || null,
    });
  } catch (err) {
    console.error("Sound config PUT error:", err);
    return res.status(500).json({ error: "Failed to update sound config" });
  }
}));

// ============================================================
// CHAT FIX ROUTE
// ============================================================
app.post("/api/chat_fix", requireAuth(async (req, res) => {
  const { mermaidCode, errorMsg, chatHistory, canvasId } = req.body;
  if (!mermaidCode || !errorMsg) return res.status(400).json({ error: "Missing required fields" });

  try {
    const { data: user } = await supabase.from("users").select("api_key_encrypted, active_model_id").eq("id", req.auth.userId).single();
    if (!user?.api_key_encrypted) return res.status(400).json({ error: "No API key configured" });

    const apiKey = decrypt(user.api_key_encrypted);
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
      if (model) modelId = model.model_id;
    }

    const { data: rules } = await supabase.from("sanitization_rules").select("rule_description").eq("is_active", true);
    
    // Fetch active skill notes
    let skillText = "";
    if (canvasId) {
      try {
        const { data: activeSkills } = await supabase.from("skill_note_attachments")
          .select("skill_notes(title, instruction_text)")
          .eq("user_id", req.auth.userId).eq("is_active", true).eq("trigger_mode", "automatic")
          .or(`canvas_id.eq.${canvasId},scope.eq.global`);
        const skills = (activeSkills || []).filter(d => d.skill_notes);
        if (skills.length > 0) {
          skillText = "\n\nACTIVE SKILL NOTES (also follow these preferences):\n" +
            skills.map((s, i) => `${i + 1}. ${s.skill_notes.title}: ${s.skill_notes.instruction_text}`).join("\n");
        }
      } catch { /* non-fatal */ }
    }

    let rulesText = "";
    if (rules && rules.length > 0) {
      rulesText = "\n\nAdditionally, you MUST adhere to these global sanitization rules:\n" + 
        rules.map((r, i) => `${i + 1}. ${r.rule_description}`).join("\n");
    }

    const openai = new OpenAI({ apiKey });
    
    const messages = [
      {
        role: "system",
        content: `You are IntelliDraw's Code Fixer. The previous AI attempted to generate Mermaid code, but the Mermaid parser crashed.
        
YOUR TASK:
Return the COMPLETE, fixed Mermaid code in a single markdown code block (\`\`\`mermaid \`\`\`).
Do NOT reply with explanations. Only return the code.

CURRENT BROKEN CODE:
\`\`\`mermaid
${mermaidCode}
\`\`\`

THE PARSER ERROR WAS:
${errorMsg}

Please fix the specific error mentioned above.
ALSO: Check the rest of the code for any standard syntax issues that typically cause Mermaid to fail (e.g., unescaped parentheses in node string values).${rulesText}${skillText}`
      }
    ];

    const history = Array.isArray(chatHistory) ? chatHistory.slice(-10) : [];
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    
    messages.push({ role: "user", content: "Please fix the code." });

    const completion = await openai.chat.completions.create({
      model: modelId, messages, max_tokens: 4096, temperature: 0.2,
    });

    const aiResponse = completion.choices[0]?.message?.content || "";
    const mermaidMatch = aiResponse.match(/```mermaid\s*\n([\s\S]*?)```/)
      || aiResponse.match(/```\s*\n([\s\S]*?)```/);
    const updatedMermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    return res.status(200).json({ response: aiResponse, updatedMermaidCode, model: modelId });
  } catch (err) {
    console.error("Chat Fix error:", err);
    return res.status(500).json({ error: err.message || "Failed to fix code" });
  }
}));

// ============================================================
// VOICE TRANSCRIPTION (Whisper)
// ============================================================
const __vt_filename = fileURLToPath(import.meta.url);
const __vt_dirname = path.dirname(__vt_filename);
const uploadsDir = path.join(__vt_dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const vtStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, _file, cb) => cb(null, `recording-${Date.now()}.webm`),
});
const upload = multer({ storage: vtStorage, limits: { fileSize: 25 * 1024 * 1024 } });

app.post("/api/transcribe", upload.single("audio"), requireAuth(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file received." });
  }

  const filePath = req.file.path;

  try {
    // Get user's own API key
    const { data: user } = await supabase
      .from("users").select("api_key_encrypted")
      .eq("id", req.auth.userId).single();

    if (!user?.api_key_encrypted) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: "No API key configured. Please add your OpenAI API key in Settings." });
    }

    const apiKey = decrypt(user.api_key_encrypted);
    const openai = new OpenAI({ apiKey });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });

    // Delete the audio file immediately after transcription
    fs.unlink(filePath, (err) => {
      if (err) console.error("Failed to delete audio file:", err);
    });

    return res.json({ text: transcription.text });
  } catch (err) {
    // Clean up on error too
    fs.unlink(filePath, () => {});
    console.error("Transcription error:", err);
    return res.status(500).json({ error: err.message || "Transcription failed." });
  }
}));

// ============================================================
// SKILL NOTES CRUD
// ============================================================
app.get("/api/skills", requireAuth(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("skill_notes").select("*")
      .eq("owner_id", req.auth.userId)
      .order("updated_at", { ascending: false });
    if (error) { console.error("GET /api/skills error:", error); return res.status(500).json({ error: error.message || "Failed to fetch skills" }); }
    return res.json({ skills: data || [] });
  } catch (err) { console.error("GET /api/skills catch:", err); return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/skills", requireAuth(async (req, res) => {
  const { title, description, instruction_text, category } = req.body || {};
  if (!title || !instruction_text) return res.status(400).json({ error: "Title and instruction_text are required" });
  try {
    const { data, error } = await supabase.from("skill_notes")
      .insert({ owner_id: req.auth.userId, title, description: description || "", instruction_text, category: category || "general" })
      .select("*").single();
    if (error) { console.error("POST /api/skills error:", error); return res.status(500).json({ error: error.message || "Failed to create skill" }); }
    return res.status(201).json({ skill: data });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.put("/api/skills/:id", requireAuth(async (req, res) => {
  const { title, description, instruction_text, category } = req.body || {};
  try {
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (instruction_text !== undefined) updates.instruction_text = instruction_text;
    if (category !== undefined) updates.category = category;
    // Bump version when instruction changes
    if (instruction_text !== undefined) {
      const { data: current } = await supabase.from("skill_notes").select("version").eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
      if (current) updates.version = (current.version || 1) + 1;
    }
    const { data, error } = await supabase.from("skill_notes").update(updates)
      .eq("id", req.params.id).eq("owner_id", req.auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Skill not found or update failed" });
    return res.json({ skill: data });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.delete("/api/skills/:id", requireAuth(async (req, res) => {
  try {
    const { error } = await supabase.from("skill_notes").delete()
      .eq("id", req.params.id).eq("owner_id", req.auth.userId);
    if (error) return res.status(500).json({ error: "Failed to delete skill" });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

// ============================================================
// SKILL NOTES MARKETPLACE
// ============================================================
app.get("/api/skills/marketplace", requireAuth(async (req, res) => {
  try {
    const { search, category, page } = req.query;
    const pageSize = 30;
    const offset = ((parseInt(page) || 1) - 1) * pageSize;
    let query = supabase.from("skill_notes")
      .select("*, users!skill_notes_owner_id_fkey(display_name, email)", { count: "exact" })
      .eq("is_published", true)
      .order("stars", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (search) query = query.ilike("title", `%${search}%`);
    if (category && category !== "all") query = query.eq("category", category);
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: "Failed to fetch marketplace" });
    const skills = (data || []).map(s => ({
      ...s, owner_display_name: s.users?.display_name, owner_email: s.users?.email, users: undefined
    }));
    return res.json({ skills, total: count || 0, page: parseInt(page) || 1, pageSize });
  } catch (err) { console.error("Marketplace error:", err); return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/skills/:id/install", requireAuth(async (req, res) => {
  try {
    const { data: source, error: srcErr } = await supabase.from("skill_notes").select("*").eq("id", req.params.id).single();
    if (srcErr || !source) return res.status(404).json({ error: "Skill not found" });
    const { data: copy, error } = await supabase.from("skill_notes").insert({
      owner_id: req.auth.userId, title: source.title, description: source.description,
      instruction_text: source.instruction_text, category: source.category,
      source_skill_id: source.id, source_version: source.version,
    }).select("*").single();
    if (error) return res.status(500).json({ error: "Failed to install skill" });
    return res.status(201).json({ skill: copy });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.put("/api/skills/:id/publish", requireAuth(async (req, res) => {
  const { is_published } = req.body || {};
  try {
    const { data, error } = await supabase.from("skill_notes")
      .update({ is_published: !!is_published, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("owner_id", req.auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Skill not found" });
    return res.json({ skill: data });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

// ============================================================
// SKILL NOTES SHARING
// ============================================================
app.post("/api/skills/:id/share", requireAuth(async (req, res) => {
  const { email, group_id } = req.body || {};
  if (!email && !group_id) return res.status(400).json({ error: "email or group_id required" });
  try {
    const { data: skill } = await supabase.from("skill_notes").select("id").eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
    if (!skill) return res.status(403).json({ error: "You can only share skills you own" });
    const shareRow = { skill_note_id: req.params.id, shared_by: req.auth.userId };
    if (email) {
      const { data: targetUser } = await supabase.from("users").select("id").eq("email", email.toLowerCase()).single();
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      shareRow.shared_with_user_id = targetUser.id;
    } else {
      shareRow.shared_with_group_id = group_id;
    }
    const { data, error } = await supabase.from("skill_note_shares").insert(shareRow).select("*").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "Already shared" }); return res.status(500).json({ error: "Failed to share" }); }
    return res.status(201).json({ share: data });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.delete("/api/skills/:id/share", requireAuth(async (req, res) => {
  const { user_id, group_id } = req.body || {};
  try {
    let query = supabase.from("skill_note_shares").delete()
      .eq("skill_note_id", req.params.id).eq("shared_by", req.auth.userId);
    if (user_id) query = query.eq("shared_with_user_id", user_id);
    if (group_id) query = query.eq("shared_with_group_id", group_id);
    const { error } = await query;
    if (error) return res.status(500).json({ error: "Failed to unshare" });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.get("/api/skills/shared-with-me", requireAuth(async (req, res) => {
  try {
    // Direct shares
    const { data: directShares } = await supabase.from("skill_note_shares")
      .select("skill_note_id, skill_notes(*,users!skill_notes_owner_id_fkey(display_name,email))")
      .eq("shared_with_user_id", req.auth.userId);
    // Group shares
    const { data: myGroups } = await supabase.from("group_members").select("group_id").eq("user_id", req.auth.userId);
    const groupIds = (myGroups || []).map(g => g.group_id);
    let groupShares = [];
    if (groupIds.length > 0) {
      const { data } = await supabase.from("skill_note_shares")
        .select("skill_note_id, skill_notes(*,users!skill_notes_owner_id_fkey(display_name,email))")
        .in("shared_with_group_id", groupIds);
      groupShares = data || [];
    }
    const seen = new Set();
    const skills = [];
    for (const s of [...(directShares || []), ...groupShares]) {
      if (s.skill_notes && !seen.has(s.skill_note_id)) {
        seen.add(s.skill_note_id);
        skills.push({ ...s.skill_notes, owner_display_name: s.skill_notes.users?.display_name, owner_email: s.skill_notes.users?.email, users: undefined });
      }
    }
    return res.json({ skills });
  } catch (err) { console.error("Shared-with-me error:", err); return res.status(500).json({ error: "Internal server error" }); }
}));

// ============================================================
// SKILL NOTE ATTACHMENTS
// ============================================================
app.get("/api/skills/attachments", requireAuth(async (req, res) => {
  try {
    const { canvasId } = req.query;
    let query = supabase.from("skill_note_attachments")
      .select("*, skill_notes(*)").eq("user_id", req.auth.userId);
    if (canvasId) {
      // Local attachments for this canvas + all global attachments
      query = supabase.from("skill_note_attachments")
        .select("*, skill_notes(*)")
        .eq("user_id", req.auth.userId)
        .or(`canvas_id.eq.${canvasId},scope.eq.global`);
    }
    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: "Failed to fetch attachments" });
    const attachments = (data || []).map(a => ({ ...a, skill_note: a.skill_notes, skill_notes: undefined }));
    return res.json({ attachments });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/skills/attachments", requireAuth(async (req, res) => {
  const { skill_note_id, canvas_id, scope, trigger_mode } = req.body || {};
  if (!skill_note_id || !scope || !trigger_mode) return res.status(400).json({ error: "skill_note_id, scope, trigger_mode required" });
  try {
    const row = { skill_note_id, user_id: req.auth.userId, scope, trigger_mode, is_active: true };
    if (canvas_id && scope === "local") row.canvas_id = canvas_id;
    const { data, error } = await supabase.from("skill_note_attachments").insert(row).select("*, skill_notes(*)").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "Already attached" }); return res.status(500).json({ error: "Failed to attach" }); }
    // Increment stars
    await supabase.rpc("increment_field", { row_id: skill_note_id, table_name: "skill_notes", field_name: "stars", amount: 1 }).catch(() => {
      supabase.from("skill_notes").update({ stars: supabase.raw("stars + 1") }).eq("id", skill_note_id).then(() => {});
    });
    // Fallback: direct increment
    await supabase.from("skill_notes").select("stars").eq("id", skill_note_id).single().then(async ({ data: sn }) => {
      if (sn) await supabase.from("skill_notes").update({ stars: (sn.stars || 0) + 1 }).eq("id", skill_note_id);
    });
    return res.status(201).json({ attachment: { ...data, skill_note: data.skill_notes, skill_notes: undefined } });
  } catch (err) { console.error("Attach error:", err); return res.status(500).json({ error: "Internal server error" }); }
}));

app.put("/api/skills/attachments/:id", requireAuth(async (req, res) => {
  const { is_active } = req.body;
  try {
    const { data, error } = await supabase.from("skill_note_attachments")
      .update({ is_active }).eq("id", req.params.id).eq("user_id", req.auth.userId).select("*, skill_notes(*)").single();
    if (error || !data) return res.status(404).json({ error: "Attachment not found" });
    return res.json({ attachment: { ...data, skill_note: data.skill_notes, skill_notes: undefined } });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.delete("/api/skills/attachments/:id", requireAuth(async (req, res) => {
  try {
    // Get the attachment to find skill_note_id for star decrement
    const { data: att } = await supabase.from("skill_note_attachments").select("skill_note_id")
      .eq("id", req.params.id).eq("user_id", req.auth.userId).single();
    const { error } = await supabase.from("skill_note_attachments").delete()
      .eq("id", req.params.id).eq("user_id", req.auth.userId);
    if (error) return res.status(500).json({ error: "Failed to detach" });
    // Decrement stars
    if (att) {
      const { data: sn } = await supabase.from("skill_notes").select("stars").eq("id", att.skill_note_id).single();
      if (sn) await supabase.from("skill_notes").update({ stars: Math.max(0, (sn.stars || 0) - 1) }).eq("id", att.skill_note_id);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

// Active skills for AI injection
app.get("/api/skills/active", requireAuth(async (req, res) => {
  try {
    const { canvasId } = req.query;
    if (!canvasId) return res.json({ instructions: [] });
    const { data, error } = await supabase.from("skill_note_attachments")
      .select("skill_notes(title, instruction_text)")
      .eq("user_id", req.auth.userId)
      .eq("is_active", true)
      .eq("trigger_mode", "automatic")
      .or(`canvas_id.eq.${canvasId},scope.eq.global`);
    if (error) return res.json({ instructions: [] });
    const instructions = (data || []).filter(d => d.skill_notes).map(d => ({
      title: d.skill_notes.title, instruction: d.skill_notes.instruction_text
    }));
    return res.json({ instructions });
  } catch (err) { return res.json({ instructions: [] }); }
}));

// ============================================================
// SKILL VERSION SYNC
// ============================================================
app.get("/api/skills/:id/check-update", requireAuth(async (req, res) => {
  try {
    const { data: skill } = await supabase.from("skill_notes").select("source_skill_id, source_version")
      .eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
    if (!skill?.source_skill_id) return res.json({ has_update: false });
    const { data: source } = await supabase.from("skill_notes").select("version").eq("id", skill.source_skill_id).single();
    if (!source) return res.json({ has_update: false });
    return res.json({ has_update: source.version > (skill.source_version || 0), source_version: source.version, local_version: skill.source_version });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/skills/:id/sync", requireAuth(async (req, res) => {
  try {
    const { data: skill } = await supabase.from("skill_notes").select("source_skill_id")
      .eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
    if (!skill?.source_skill_id) return res.status(400).json({ error: "No source skill to sync from" });
    const { data: source } = await supabase.from("skill_notes").select("title, description, instruction_text, category, version")
      .eq("id", skill.source_skill_id).single();
    if (!source) return res.status(404).json({ error: "Source skill no longer exists" });
    const { data: updated, error } = await supabase.from("skill_notes").update({
      title: source.title, description: source.description, instruction_text: source.instruction_text,
      category: source.category, source_version: source.version, updated_at: new Date().toISOString()
    }).eq("id", req.params.id).eq("owner_id", req.auth.userId).select("*").single();
    if (error) return res.status(500).json({ error: "Failed to sync" });
    return res.json({ skill: updated });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

// ============================================================
// MANUAL SKILL TRIGGER
// ============================================================
app.post("/api/skills/trigger", requireAuth(async (req, res) => {
  const { skill_note_id: skillNoteId, canvas_id: canvasId } = req.body || {};
  if (!skillNoteId || !canvasId) return res.status(400).json({ error: "skillNoteId and canvasId required" });
  try {
    const { data: user } = await supabase.from("users").select("api_key_encrypted, active_model_id").eq("id", req.auth.userId).single();
    if (!user?.api_key_encrypted) return res.status(400).json({ error: "No API key configured" });
    const { data: skill } = await supabase.from("skill_notes").select("title, instruction_text").eq("id", skillNoteId).single();
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    const { data: canvas } = await supabase.from("canvases").select("mermaid_code").eq("id", canvasId).eq("user_id", req.auth.userId).single();
    if (!canvas) return res.status(404).json({ error: "Canvas not found" });
    const apiKey = decrypt(user.api_key_encrypted);
    let modelId = "gpt-4o";
    if (user.active_model_id) {
      const { data: model } = await supabase.from("ai_models").select("model_id").eq("id", user.active_model_id).single();
      if (model) modelId = model.model_id;
    }
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: modelId, max_tokens: 4096, temperature: 0.7,
      messages: [
        { role: "system", content: `You are IntelliDraw, an AI flowchart assistant. You are executing a manual skill note.\n\nSKILL: ${skill.title}\nINSTRUCTION:\n${skill.instruction_text}\n\nCURRENT MERMAID CODE:\n\`\`\`mermaid\n${canvas.mermaid_code}\n\`\`\`\n\nApply the skill instruction to the current flowchart. Return the COMPLETE updated Mermaid code in a fenced code block with the language identifier "mermaid". Also provide a brief explanation of what you changed.` },
        { role: "user", content: `Please apply the skill "${skill.title}" to my flowchart.` }
      ]
    });
    const aiResponse = completion.choices[0]?.message?.content || "";
    const mermaidMatch = aiResponse.match(/```mermaid\n([\s\S]*?)```/);
    return res.json({ response: aiResponse, updatedMermaidCode: mermaidMatch ? mermaidMatch[1].trim() : null, model: modelId, skillTitle: skill.title });
  } catch (err) { console.error("Skill trigger error:", err); return res.status(500).json({ error: err.message || "Failed to trigger skill" }); }
}));

// ============================================================
// USER GROUPS
// ============================================================
app.get("/api/groups", requireAuth(async (req, res) => {
  try {
    // Groups I own
    const { data: owned } = await supabase.from("user_groups").select("*, group_members(id, user_id, added_at, users!group_members_user_id_fkey(display_name, email))").eq("owner_id", req.auth.userId).order("created_at", { ascending: false });
    // Groups I'm a member of
    const { data: memberships } = await supabase.from("group_members").select("group_id").eq("user_id", req.auth.userId);
    const memberGroupIds = (memberships || []).map(m => m.group_id);
    let memberGroups = [];
    if (memberGroupIds.length > 0) {
      const { data } = await supabase.from("user_groups")
        .select("*, group_members(id, user_id, added_at, users!group_members_user_id_fkey(display_name, email))")
        .in("id", memberGroupIds).neq("owner_id", req.auth.userId);
      memberGroups = data || [];
    }
    const formatGroup = (g) => ({
      ...g, members: (g.group_members || []).map(m => ({
        id: m.id, group_id: g.id, user_id: m.user_id, added_at: m.added_at,
        display_name: m.users?.display_name, email: m.users?.email
      })), member_count: (g.group_members || []).length, group_members: undefined
    });
    return res.json({ groups: [...(owned || []).map(formatGroup), ...memberGroups.map(formatGroup)] });
  } catch (err) { console.error("Groups error:", err); return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/groups", requireAuth(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Group name is required" });
  try {
    const { data, error } = await supabase.from("user_groups").insert({ name, owner_id: req.auth.userId }).select("*").single();
    if (error) { console.error("POST /api/groups error:", error); return res.status(500).json({ error: error.message || "Failed to create group" }); }
    return res.status(201).json({ group: { ...data, members: [], member_count: 0 } });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.put("/api/groups/:id", requireAuth(async (req, res) => {
  const { name } = req.body || {};
  try {
    const { data, error } = await supabase.from("user_groups").update({ name }).eq("id", req.params.id).eq("owner_id", req.auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Group not found" });
    return res.json({ group: data });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.delete("/api/groups/:id", requireAuth(async (req, res) => {
  try {
    const { error } = await supabase.from("user_groups").delete().eq("id", req.params.id).eq("owner_id", req.auth.userId);
    if (error) return res.status(500).json({ error: "Failed to delete group" });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.post("/api/groups/:id/members", requireAuth(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });
  try {
    const { data: group } = await supabase.from("user_groups").select("id").eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
    if (!group) return res.status(403).json({ error: "Only group owners can add members" });
    const { data: targetUser } = await supabase.from("users").select("id, display_name, email").eq("email", email.toLowerCase()).single();
    if (!targetUser) return res.status(404).json({ error: "User not found with that email" });
    const { data, error } = await supabase.from("group_members")
      .insert({ group_id: req.params.id, user_id: targetUser.id }).select("*").single();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "User is already a member" }); return res.status(500).json({ error: "Failed to add member" }); }
    return res.status(201).json({ member: { ...data, display_name: targetUser.display_name, email: targetUser.email } });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

app.delete("/api/groups/:id/members{/:userId}", requireAuth(async (req, res) => {
  try {
    const userId = req.params.userId || req.body?.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const { data: group } = await supabase.from("user_groups").select("id").eq("id", req.params.id).eq("owner_id", req.auth.userId).single();
    if (!group) return res.status(403).json({ error: "Only group owners can remove members" });
    const { error } = await supabase.from("group_members").delete().eq("group_id", req.params.id).eq("user_id", userId);
    if (error) return res.status(500).json({ error: "Failed to remove member" });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Internal server error" }); }
}));

// ============================================================
// ADMIN ONBOARDING TUTORIALS
// ============================================================

// GET: List all tutorials
app.get("/api/admin/onboarding", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { data, error } = await supabase
      .from("onboarding_tutorials")
      .select("*")
      .order("step_order", { ascending: true });

    if (error) return res.status(500).json({ error: "Failed to fetch tutorials" });
    return res.json({ tutorials: data || [] });
  } catch (err) {
    console.error("GET /api/admin/onboarding error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// POST: Create tutorial
app.post("/api/admin/onboarding", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const { gif_file_data, gif_file_name, explanation_text, attached_page, step_order, force_existing_users } = req.body || {};

    if (!explanation_text || !attached_page || step_order === undefined) {
      return res.status(400).json({ error: "explanation_text, attached_page, and step_order are required" });
    }

    // Upload GIF to Supabase Storage
    let gifUrl = null;
    let gifFileName = null;

    if (gif_file_data) {
      const ext = gif_file_name?.match(/\.[^.]+$/)?.[0] || ".gif";
      const storagePath = `onboarding-${Date.now()}${ext}`;
      const buffer = Buffer.from(gif_file_data, "base64");

      const { error: uploadErr } = await supabase.storage
        .from("onboarding-gifs")
        .upload(storagePath, buffer, { contentType: "image/gif", upsert: true });

      if (uploadErr) {
        console.error("GIF upload error:", uploadErr);
        return res.status(500).json({ error: "Failed to upload GIF" });
      }

      const { data: publicUrlData } = supabase.storage.from("onboarding-gifs").getPublicUrl(storagePath);
      gifUrl = publicUrlData.publicUrl;
      gifFileName = gif_file_name || "onboarding.gif";
    }

    const { data: tutorial, error: insertErr } = await supabase
      .from("onboarding_tutorials")
      .insert({ step_order: Number(step_order), gif_url: gifUrl, gif_file_name: gifFileName, explanation_text, attached_page })
      .select("*")
      .single();

    if (insertErr) {
      console.error("Tutorial insert error:", insertErr);
      return res.status(500).json({ error: "Failed to create tutorial" });
    }

    // Waiver logic
    let waived_count = 0;
    if (force_existing_users === false) {
      const { data: states } = await supabase.from("user_onboarding_state").select("id, user_id, seen_onboarding");
      if (states && states.length > 0) {
        const { data: priorTutorials } = await supabase
          .from("onboarding_tutorials").select("id")
          .lte("step_order", Number(step_order)).neq("id", tutorial.id);

        const priorIds = new Set((priorTutorials || []).map(t => t.id));

        for (const state of states) {
          const seen = state.seen_onboarding || {};
          const allPriorSeen = priorIds.size > 0 && [...priorIds].every(pid => {
            const entry = seen[pid];
            return entry && (entry.status === "completed" || entry.status === "waived");
          });

          if (allPriorSeen) {
            const updatedSeen = {
              ...seen,
              [tutorial.id]: { status: "waived", seen_at: null, content_updated_at_seen: null, waived_at: new Date().toISOString() },
            };
            await supabase.from("user_onboarding_state")
              .update({ seen_onboarding: updatedSeen, updated_at: new Date().toISOString() })
              .eq("id", state.id);
            waived_count++;
          }
        }
      }
    }

    return res.status(201).json({ tutorial, waived_count });
  } catch (err) {
    console.error("POST /api/admin/onboarding error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// PUT: Update tutorial
app.put("/api/admin/onboarding/:id", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const tutorialId = req.params.id;
    const { gif_file_data, gif_file_name, explanation_text, attached_page, step_order, force_existing_users } = req.body || {};

    const { data: current, error: fetchErr } = await supabase
      .from("onboarding_tutorials").select("*").eq("id", tutorialId).single();

    if (fetchErr || !current) return res.status(404).json({ error: "Tutorial not found" });

    const updates = { updated_at: new Date().toISOString() };
    let contentChanged = false;

    if (explanation_text !== undefined && explanation_text !== current.explanation_text) {
      updates.explanation_text = explanation_text;
      contentChanged = true;
    }
    if (attached_page !== undefined) updates.attached_page = attached_page;

    // GIF replacement
    if (gif_file_data) {
      if (current.gif_url && current.gif_url.includes("/onboarding-gifs/")) {
        const oldFileName = current.gif_url.split("/onboarding-gifs/").pop();
        if (oldFileName) await supabase.storage.from("onboarding-gifs").remove([oldFileName]);
      }

      const ext = gif_file_name?.match(/\.[^.]+$/)?.[0] || ".gif";
      const storagePath = `onboarding-${Date.now()}${ext}`;
      const buffer = Buffer.from(gif_file_data, "base64");

      const { error: uploadErr } = await supabase.storage
        .from("onboarding-gifs")
        .upload(storagePath, buffer, { contentType: "image/gif", upsert: true });

      if (uploadErr) return res.status(500).json({ error: "Failed to upload GIF" });

      const { data: publicUrlData } = supabase.storage.from("onboarding-gifs").getPublicUrl(storagePath);
      updates.gif_url = publicUrlData.publicUrl;
      updates.gif_file_name = gif_file_name || "onboarding.gif";
      contentChanged = true;
    }

    if (contentChanged) updates.content_updated_at = new Date().toISOString();

    // Step order change + waiver
    let waived_count = 0;
    if (step_order !== undefined && Number(step_order) !== current.step_order) {
      updates.step_order = Number(step_order);

      if (force_existing_users === false) {
        const { data: states } = await supabase.from("user_onboarding_state").select("id, user_id, seen_onboarding");
        if (states) {
          for (const state of states) {
            const seen = state.seen_onboarding || {};
            const entry = seen[tutorialId];
            if (!entry || !entry.status) {
              const { data: priorTutorials } = await supabase
                .from("onboarding_tutorials").select("id")
                .lte("step_order", Number(step_order)).neq("id", tutorialId);

              const priorIds = (priorTutorials || []).map(t => t.id);
              const allPriorSeen = priorIds.length > 0 && priorIds.every(pid => {
                const priorEntry = seen[pid];
                return priorEntry && (priorEntry.status === "completed" || priorEntry.status === "waived");
              });

              if (allPriorSeen) {
                const updatedSeen = {
                  ...seen,
                  [tutorialId]: { status: "waived", seen_at: null, content_updated_at_seen: null, waived_at: new Date().toISOString() },
                };
                await supabase.from("user_onboarding_state")
                  .update({ seen_onboarding: updatedSeen, updated_at: new Date().toISOString() })
                  .eq("id", state.id);
                waived_count++;
              }
            }
          }
        }
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("onboarding_tutorials").update(updates).eq("id", tutorialId).select("*").single();

    if (updateErr) return res.status(500).json({ error: "Failed to update tutorial" });
    return res.json({ tutorial: updated, content_changed: contentChanged, waived_count });
  } catch (err) {
    console.error("PUT /api/admin/onboarding/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// DELETE: Delete tutorial
app.delete("/api/admin/onboarding/:id", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("is_global_admin").eq("id", req.auth.userId).single();
    if (!user?.is_global_admin) return res.status(403).json({ error: "Forbidden" });

    const tutorialId = req.params.id;

    // Clean up GIF storage
    const { data: current } = await supabase.from("onboarding_tutorials").select("gif_url").eq("id", tutorialId).single();
    if (current?.gif_url && current.gif_url.includes("/onboarding-gifs/")) {
      const oldFileName = current.gif_url.split("/onboarding-gifs/").pop();
      if (oldFileName) await supabase.storage.from("onboarding-gifs").remove([oldFileName]);
    }

    const { error } = await supabase.from("onboarding_tutorials").delete().eq("id", tutorialId);
    if (error) return res.status(500).json({ error: "Failed to delete tutorial" });
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/admin/onboarding/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// USER ONBOARDING STATE
// ============================================================

// GET: Get onboarding state + next required tutorial
app.get("/api/onboarding/state", requireAuth(async (req, res) => {
  try {
    let { data: state } = await supabase
      .from("user_onboarding_state").select("*")
      .eq("user_id", req.auth.userId).single();

    if (!state) {
      const { data: newState, error: createErr } = await supabase
        .from("user_onboarding_state")
        .insert({ user_id: req.auth.userId, seen_onboarding: {} })
        .select("*").single();

      if (createErr) return res.status(500).json({ error: "Failed to initialize onboarding state" });
      state = newState;
    }

    const { data: tutorials, error: tutErr } = await supabase
      .from("onboarding_tutorials").select("*")
      .order("step_order", { ascending: true });

    if (tutErr) return res.status(500).json({ error: "Failed to fetch tutorials" });

    const seen = state.seen_onboarding || {};
    const allTutorials = tutorials || [];

    let nextRequired = null;
    let isRewatch = false;

    for (const tutorial of allTutorials) {
      const entry = seen[tutorial.id];

      if (!entry) {
        nextRequired = tutorial;
        isRewatch = false;
        break;
      }

      if (entry.status === "waived") continue;

      if (entry.status === "completed") {
        if (tutorial.content_updated_at && entry.content_updated_at_seen &&
            new Date(tutorial.content_updated_at) > new Date(entry.content_updated_at_seen)) {
          nextRequired = tutorial;
          isRewatch = true;
          break;
        }
        if (tutorial.content_updated_at && !entry.content_updated_at_seen) {
          nextRequired = tutorial;
          isRewatch = true;
          break;
        }
        continue;
      }
    }

    return res.json({
      state,
      next_required: nextRequired,
      is_rewatch: isRewatch,
      total_tutorials: allTutorials.length,
      completed_count: Object.values(seen).filter(e => e.status === "completed" || e.status === "waived").length,
    });
  } catch (err) {
    console.error("GET /api/onboarding/state error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// POST: Mark tutorial as completed
app.post("/api/onboarding/state", requireAuth(async (req, res) => {
  try {
    const { onboarding_id } = req.body || {};
    if (!onboarding_id) return res.status(400).json({ error: "onboarding_id is required" });

    const { data: tutorial } = await supabase
      .from("onboarding_tutorials").select("content_updated_at")
      .eq("id", onboarding_id).single();

    if (!tutorial) return res.status(404).json({ error: "Tutorial not found" });

    const { data: state } = await supabase
      .from("user_onboarding_state").select("id, seen_onboarding")
      .eq("user_id", req.auth.userId).single();

    if (!state) return res.status(404).json({ error: "Onboarding state not found" });

    const seen = state.seen_onboarding || {};
    const now = new Date().toISOString();

    const updatedSeen = {
      ...seen,
      [onboarding_id]: {
        status: "completed",
        seen_at: now,
        content_updated_at_seen: tutorial.content_updated_at || now,
        waived_at: null,
      },
    };

    const { error: updateErr } = await supabase
      .from("user_onboarding_state")
      .update({ seen_onboarding: updatedSeen, updated_at: now })
      .eq("id", state.id);

    if (updateErr) return res.status(500).json({ error: "Failed to mark tutorial as completed" });
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/onboarding/state error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 IntelliDraw API server running on http://localhost:${PORT}`);
  console.log(`   Supabase URL: ${supabaseUrl}`);
  console.log(`   Ready for requests!\n`);
});
