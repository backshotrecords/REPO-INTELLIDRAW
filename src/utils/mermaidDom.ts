import type { MermaidAST } from "./mermaidParser";
import { normalizeMermaidDisplayLabel } from "./mermaidParser";

function compactLabel(value: string): string {
  return normalizeMermaidDisplayLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getClusterIdCandidates(cluster: Element): string[] {
  const id = cluster.id || "";
  if (!id) return [];

  const candidates = new Set<string>([id]);
  const flowchartMatch = id.match(/(?:flowchart|graph)-(.+)-\d+$/);
  if (flowchartMatch) candidates.add(flowchartMatch[1]);

  candidates.add(id.replace(/^cluster[-_]/i, ""));
  candidates.add(id.replace(/^(?:flowchart|graph)[-_]/i, ""));

  return [...candidates].filter(Boolean);
}

export function getRenderedClusterSubgraphId(
  cluster: Element,
  parsedAST: MermaidAST | null
): string | null {
  if (!parsedAST) return null;

  for (const candidate of getClusterIdCandidates(cluster)) {
    if (parsedAST.allSubgraphsFlat.has(candidate)) return candidate;
  }

  const labelEl = cluster.querySelector(".cluster-label");
  if (!labelEl) return null;

  const clusterLabelText = normalizeMermaidDisplayLabel(labelEl.textContent || "").toLowerCase();
  const clusterCompactLabel = compactLabel(labelEl.textContent || "");
  if (!clusterLabelText && !clusterCompactLabel) return null;

  for (const sg of parsedAST.allSubgraphsFlat.values()) {
    const normalizedLabel = normalizeMermaidDisplayLabel(sg.label).toLowerCase();
    const compact = compactLabel(sg.label);

    if (
      clusterLabelText === normalizedLabel ||
      clusterLabelText.includes(normalizedLabel) ||
      normalizedLabel.includes(clusterLabelText) ||
      (compact && clusterCompactLabel === compact)
    ) {
      return sg.id;
    }
  }

  return null;
}
