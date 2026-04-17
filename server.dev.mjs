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
  const { title, mermaidCode, chatHistory } = req.body || {};
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
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

// ============================================================
// CHAT ROUTE
// ============================================================
app.post("/api/chat", requireAuth(async (req, res) => {
  const { message, mermaidCode, chatHistory } = req.body;
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
7. Use descriptive node labels and proper flow connections`,
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
      .from("users").select("id, email, display_name, api_key_encrypted, active_model_id")
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
        activeModelId: user.active_model_id, hasApiKey: !!user.api_key_encrypted, maskedApiKey: maskedKey,
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
    const { error } = await supabase.from("users").update({ api_key_encrypted: encryptedKey }).eq("id", req.auth.userId);
    if (error) return res.status(500).json({ error: "Failed to save API key" });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}));

app.get("/api/settings/apikey", requireAuth(async (req, res) => {
  try {
    const { data: user } = await supabase.from("users").select("api_key_encrypted").eq("id", req.auth.userId).single();
    if (!user?.api_key_encrypted) return res.status(200).json({ apiKey: null });
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
  const { mermaidCode, errorMsg, chatHistory } = req.body;
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
ALSO: Check the rest of the code for any standard syntax issues that typically cause Mermaid to fail (e.g., unescaped parentheses in node string values).${rulesText}`
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
// START SERVER
// ============================================================
const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 IntelliDraw API server running on http://localhost:${PORT}`);
  console.log(`   Supabase URL: ${supabaseUrl}`);
  console.log(`   Ready for requests!\n`);
});
