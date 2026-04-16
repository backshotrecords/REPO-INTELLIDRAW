import fs from "fs";
import path from "path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./lib/db.js";

// Helper for generating mermaid.ink URL
const getMermaidImageUrl = (mermaidCode: string) => {
  try {
    const state = { code: mermaidCode, mermaid: { theme: "default" } };
    const base64 = Buffer.from(JSON.stringify(state)).toString("base64");
    return `https://mermaid.ink/img/${base64}`;
  } catch (err) {
    return null;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  
  // 1. Read index.html
  // Determine if we're in Vercel. In Vercel, dist/index.html is built.
  // Locally, if we run vercel dev, it might be in root or dist.
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

  let protocol = "https";
  if (req.headers.host && (req.headers.host.includes("localhost") || req.headers.host.includes("127.0.0.1"))) {
    protocol = "http";
  }
  const host = req.headers.host || "intellidraw.vercel.app";

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
      const generatedImage = getMermaidImageUrl(canvas.mermaid_code);
      if (generatedImage) imageUrl = generatedImage;
    }
  } catch (err) {
    // If not found or not public or error, we'll just serve plain HTML
    // and rely on the defaults.
    console.error("Preview fetching error:", err);
  }

  // 3. Inject tags into <head>
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
}
