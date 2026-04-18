import JSZip from "jszip";
import { saveAs } from "file-saver";
import mermaid from "mermaid";

interface CanvasData {
  title: string;
  mermaid_code: string;
}

export interface ExportOptions {
  markdown: boolean;
  png: boolean;
}

const SVG_RENDER_ID_PREFIX = "export-mermaid-";
let renderCounter = 1000;

/**
 * Converts a Mermaid code string to a PNG Image Blob.
 * This can be used generically anywhere in the app to grab raster captures.
 */
export async function convertToImageBlob(canvasInfo: CanvasData, background = "#ffffff", scale = 2): Promise<Blob> {
  const id = `${SVG_RENDER_ID_PREFIX}${renderCounter++}`;
  
  // Render SVG using mermaid
  const { svg } = await mermaid.render(id, canvasInfo.mermaid_code.trim());
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Use encodeURIComponent to handle special characters effectively
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return reject(new Error("Failed to get canvas context"));
      }
      
      // Draw background
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw SVG Image on top
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob"));
        }
      }, "image/png");
    };
    
    img.onerror = (err) => {
      reject(new Error("Failed to load SVG into Image: " + err));
    };
  });
}

/**
 * Export a single canvas as a Markdown (.md) file download.
 */
export function exportAsMarkdown(canvas: CanvasData): void {
  const content = `# ${canvas.title}\n\n\`\`\`mermaid\n${canvas.mermaid_code}\n\`\`\`\n`;
  const blob = new Blob([content], { type: "text/markdown" });
  const fileName = `${canvas.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
  saveAs(blob, fileName);
}

/**
 * Export a single canvas as a PNG format.
 */
export async function exportAsImage(canvas: CanvasData): Promise<void> {
  try {
    const blob = await convertToImageBlob(canvas);
    const fileName = `${canvas.title.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
    saveAs(blob, fileName);
  } catch (err) {
    console.error("Export image failed:", err);
    alert("Failed to export image. Ensure your flowchart code is valid.");
  }
}

/**
 * Export multiple canvases as a ZIP containing Markdown files, PNGs, or both.
 */
export async function exportAsZip(canvases: CanvasData[], options: ExportOptions = { markdown: true, png: false }): Promise<void> {
  const zip = new JSZip();

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const safeTitle = canvas.title.replace(/[^a-zA-Z0-9]/g, "_");
    const baseName = `${safeTitle}_${i + 1}`;

    if (options.markdown) {
      const content = `# ${canvas.title}\n\n\`\`\`mermaid\n${canvas.mermaid_code}\n\`\`\`\n`;
      zip.file(`${baseName}.md`, content);
    }

    if (options.png) {
      try {
        const imageBlob = await convertToImageBlob(canvas);
        zip.file(`${baseName}.png`, imageBlob);
      } catch (err) {
        console.warn(`Failed to generate PNG for canvas ${canvas.title}:`, err);
      }
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "IntelliDraw_Canvases.zip");
}
