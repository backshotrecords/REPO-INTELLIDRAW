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
 * Parses the diagram viewBox to enforce a high-resolution canvas size.
 */
export async function convertToImageBlob(canvasInfo: CanvasData, background = "#ffffff", scale = 3): Promise<Blob> {
  const id = `${SVG_RENDER_ID_PREFIX}${renderCounter++}`;
  
  // Render SVG using mermaid
  const { svg } = await mermaid.render(id, canvasInfo.mermaid_code.trim());
  
  // Try to extract native width/height from viewBox to prevent blurry default sizes
  let nativeWidth = 800;
  let nativeHeight = 600;
  const viewBoxMatch = svg.match(/viewBox=["']\s*[\d\.-]+\s+[\d\.-]+\s+([\d\.-]+)\s+([\d\.-]+)\s*["']/i);
  if (viewBoxMatch) {
    nativeWidth = parseFloat(viewBoxMatch[1]);
    nativeHeight = parseFloat(viewBoxMatch[2]);
  }

  // Scale the dimensions up to achieve high-resolution
  const finalWidth = nativeWidth * scale;
  const finalHeight = nativeHeight * scale;

  // We explicitly inject the high-resolution dimensions into the <svg> tag.
  // Using DOMParser ensures we overwrite existing width/height attributes rather than duplicating them (which would crash the Image loader)
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const svgEl = doc.documentElement;
  
  svgEl.setAttribute("width", `${finalWidth}px`);
  svgEl.setAttribute("height", `${finalHeight}px`);
  
  // Remove max-width restrictions from inline styles if present
  const styleAttr = svgEl.getAttribute("style");
  if (styleAttr) {
    svgEl.setAttribute("style", styleAttr.replace(/max-width:\s*[^;]+;?/gi, ""));
  }

  const serializer = new XMLSerializer();
  const modifiedSvg = serializer.serializeToString(svgEl);
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Use encodeURIComponent to handle special characters effectively
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(modifiedSvg)}`;
    
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      
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
