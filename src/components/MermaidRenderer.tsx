import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidRendererProps {
  code: string;
  className?: string;
  onSyntaxError?: (errorMsg: string, code: string) => void;
  isFixing?: boolean;
}

// Configure mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "Inter, sans-serif",
  flowchart: {
    curve: "basis",
    padding: 20,
    htmlLabels: true,
    useMaxWidth: true,
  },
});

let renderCounter = 0;

export default function MermaidRenderer({ code, className = "", onSyntaxError, isFixing = false }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");

  useEffect(() => {
    if (!code?.trim()) {
      setSvgHtml("");
      setError(null);
      return;
    }

    const renderDiagram = async () => {
      try {
        renderCounter++;
        const id = `mermaid-diagram-${renderCounter}`;
        const { svg } = await mermaid.render(id, code.trim());
        setSvgHtml(svg);
        setError(null);
      } catch (err) {
        console.error("Mermaid render error:", err);
        const errMsg = err instanceof Error ? err.message : "Failed to render diagram";
        if (onSyntaxError) {
          onSyntaxError(errMsg, code.trim());
          setError(null);
        } else {
          setError(errMsg);
        }
        setSvgHtml("");
      }
    };

    renderDiagram();
  }, [code]);

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="bg-error-container/30 rounded-xl p-6 max-w-md w-full border border-error/10">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="material-symbols-outlined text-error text-lg"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              error
            </span>
            <span className="text-sm font-bold text-on-error-container">Render Error</span>
          </div>
          <p className="text-xs text-on-error-container/70 font-mono leading-relaxed">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (isFixing) {
    return (
      <div className={`flex flex-col items-center justify-center p-12 ${className}`}>
        <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/20 flex flex-col items-center gap-4">
           <div className="spinner w-8 h-8 border-t-primary" />
           <p className="text-sm font-semibold text-primary tracking-tight">Debugging new code...</p>
        </div>
      </div>
    );
  }

  if (!svgHtml) {
    return (
      <div className={`flex items-center justify-center p-12 ${className}`}>
        <div className="flex flex-col items-center gap-3 text-on-surface-variant/50">
          <span className="material-symbols-outlined text-4xl">draw</span>
          <p className="text-sm">Start chatting to generate a flowchart</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container flex items-center justify-center p-4 ${className}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}
