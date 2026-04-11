import JSZip from "jszip";
import { saveAs } from "file-saver";

interface CanvasData {
  title: string;
  mermaid_code: string;
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
 * Export multiple canvases as a ZIP of Markdown files.
 */
export async function exportAsZip(canvases: CanvasData[]): Promise<void> {
  const zip = new JSZip();

  canvases.forEach((canvas, index) => {
    const content = `# ${canvas.title}\n\n\`\`\`mermaid\n${canvas.mermaid_code}\n\`\`\`\n`;
    const fileName = `${canvas.title.replace(/[^a-zA-Z0-9]/g, "_")}_${index + 1}.md`;
    zip.file(fileName, content);
  });

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "IntelliDraw_Canvases.zip");
}
