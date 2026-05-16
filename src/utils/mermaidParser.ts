/**
 * mermaidParser.ts — Mermaid AST parser for compound-node scoped canvas.
 *
 * Parses a full Mermaid flowchart source into a structured AST that identifies
 * subgraph hierarchy, node definitions, and edges. Provides utilities to:
 *   - Generate filtered Mermaid code for a specific scope (with boundary stubs)
 *   - Generate root-level view (collapsing subgraphs into compound nodes)
 *   - Extract scoped code for export (scope + all descendants)
 *   - Compute breadcrumb paths and find nearest ancestors
 */

// ── Data Structures ──────────────────────────────────────────────

export interface SubgraphNode {
  id: string;                    // subgraph ID from source
  label: string;                 // display label
  parentId: string | null;       // null = top-level
  children: SubgraphNode[];      // nested subgraphs
  sourceStart: number;           // line index of "subgraph ..."
  sourceEnd: number;             // line index of matching "end"
  directNodes: string[];         // node IDs defined at this level (not in sub-subgraphs)
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
  lineIndex: number;
  rawLine: string;
}

export interface MermaidAST {
  rootNodes: string[];                        // node IDs at root level
  subgraphs: SubgraphNode[];                  // top-level subgraphs
  allSubgraphsFlat: Map<string, SubgraphNode>;// fast lookup by ID
  edges: Edge[];                              // all edges in the document
  headerLine: string;                         // e.g. "flowchart TD"
  lines: string[];                            // original lines for source-range ops
}

export interface BoundaryRef {
  edgeIndex: number;
  direction: "incoming" | "outgoing";
  insideNodeId: string;
  externalNodeId: string;
  externalLabel: string;
  rawLine: string;
}

// ── Parsing ──────────────────────────────────────────────────────

/**
 * Parse the full Mermaid source into a structured AST.
 */
export function parseMermaidAST(code: string): MermaidAST {
  const lines = code.split("\n");
  const allSubgraphsFlat = new Map<string, SubgraphNode>();
  const topLevelSubgraphs: SubgraphNode[] = [];
  const edges: Edge[] = [];
  const allDefinedNodes = new Set<string>();

  // ── Pass 1: Identify subgraph blocks ──
  const stack: SubgraphNode[] = [];
  let headerLine = "";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Detect header (flowchart TD, graph LR, etc.)
    if (i < 5 && /^(flowchart|graph)\s+(TD|TB|BT|LR|RL)/i.test(trimmed)) {
      headerLine = trimmed;
      continue;
    }

    // Skip comments and empty lines
    if (trimmed.startsWith("%%") || trimmed === "") continue;

    // Detect subgraph start
    const sgMatch = trimmed.match(/^subgraph\s+(\S+)(?:\s*\[([^\]]*)\])?/i);
    if (sgMatch) {
      const sgId = sgMatch[1];
      // Label: either the bracketed label, or the ID itself, or text after ID
      let sgLabel = sgMatch[2] || "";
      if (!sgLabel) {
        // Check for `subgraph ID text here` pattern (label without brackets)
        const altMatch = trimmed.match(/^subgraph\s+(\S+)\s+(.+)$/i);
        sgLabel = altMatch ? altMatch[2].trim() : sgId;
      }
      // Strip surrounding quotes from label
      sgLabel = sgLabel.replace(/^["']|["']$/g, "");

      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      const node: SubgraphNode = {
        id: sgId,
        label: sgLabel,
        parentId,
        children: [],
        sourceStart: i,
        sourceEnd: -1, // filled in when we find the matching "end"
        directNodes: [],
      };

      if (parentId && allSubgraphsFlat.has(parentId)) {
        allSubgraphsFlat.get(parentId)!.children.push(node);
      } else if (!parentId) {
        topLevelSubgraphs.push(node);
      }

      allSubgraphsFlat.set(sgId, node);
      stack.push(node);
      continue;
    }

    // Detect subgraph end
    if (/^end\s*$/i.test(trimmed)) {
      const current = stack.pop();
      if (current) {
        current.sourceEnd = i;
      }
      continue;
    }

    // Detect classDef / class lines — skip, don't treat as nodes
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed)) continue;
    // Skip style directives
    if (/^style\s/i.test(trimmed)) continue;
    // Skip click/link directives
    if (/^click\s/i.test(trimmed) || /^linkStyle\s/i.test(trimmed)) continue;
    // Skip direction directives inside subgraphs
    if (/^direction\s+(TD|TB|BT|LR|RL)/i.test(trimmed)) continue;

    // Detect edges — patterns like A --> B, A -->|label| B, A -- text --> B
    const edgeMatch = parseEdge(trimmed);
    if (edgeMatch) {
      edges.push({
        from: edgeMatch.from,
        to: edgeMatch.to,
        label: edgeMatch.label,
        lineIndex: i,
        rawLine: lines[i],
      });
      // Also record these as node references
      allDefinedNodes.add(edgeMatch.from);
      allDefinedNodes.add(edgeMatch.to);

      // Assign nodes to current scope
      const currentScope = stack.length > 0 ? stack[stack.length - 1] : null;
      if (currentScope) {
        if (!isInsideChildSubgraph(currentScope, edgeMatch.from, allSubgraphsFlat)) {
          if (!currentScope.directNodes.includes(edgeMatch.from)) {
            currentScope.directNodes.push(edgeMatch.from);
          }
        }
        if (!isInsideChildSubgraph(currentScope, edgeMatch.to, allSubgraphsFlat)) {
          if (!currentScope.directNodes.includes(edgeMatch.to)) {
            currentScope.directNodes.push(edgeMatch.to);
          }
        }
      }
      continue;
    }

    // Detect standalone node definitions — ID[label], ID(label), ID{label}, etc.
    const nodeDefMatch = trimmed.match(/^([A-Za-z_]\w*)\s*[\[({<"]/);
    if (nodeDefMatch) {
      const nodeId = nodeDefMatch[1];
      allDefinedNodes.add(nodeId);

      const currentScope = stack.length > 0 ? stack[stack.length - 1] : null;
      if (currentScope) {
        if (!isInsideChildSubgraph(currentScope, nodeId, allSubgraphsFlat)) {
          if (!currentScope.directNodes.includes(nodeId)) {
            currentScope.directNodes.push(nodeId);
          }
        }
      }
    }
  }

  // ── Compute root-level nodes (not inside any subgraph) ──
  const nodesInsideSubgraphs = new Set<string>();
  for (const sg of allSubgraphsFlat.values()) {
    for (const nid of sg.directNodes) {
      nodesInsideSubgraphs.add(nid);
    }
    // Subgraph IDs themselves are also "inside"
    nodesInsideSubgraphs.add(sg.id);
  }

  const rootNodes: string[] = [];
  for (const nid of allDefinedNodes) {
    if (!nodesInsideSubgraphs.has(nid)) {
      rootNodes.push(nid);
    }
  }

  if (!headerLine) headerLine = "flowchart TD";

  return {
    rootNodes,
    subgraphs: topLevelSubgraphs,
    allSubgraphsFlat,
    edges,
    headerLine,
    lines,
  };
}

// ── Edge Parsing ─────────────────────────────────────────────────

/**
 * Parse a single line to extract edge information.
 * Handles: A --> B, A -->|label| B, A -- text --> B, A -.-> B, A ==> B, etc.
 */
function parseEdge(line: string): { from: string; to: string; label?: string } | null {
  // Pattern: FROM (arrow with optional label) TO
  // Arrows: -->, --->, -.->,-.->, ==>, ===>, --> |text|, -- text -->
  const edgeRegex = /^([A-Za-z_]\w*)\s*(?:--\s+"([^"]*)"\s*-->|--\s+([^-=.>|]+?)\s*-->|-->?\|([^|]*)\|\s*|[-=.]+>?\s*\|([^|]*)\|\s*|[-]{2,}>|[-.]{2,}>|[=]{2,}>|[-]{2,}[->]+)\s*([A-Za-z_]\w*)/;
  const match = line.match(edgeRegex);

  if (match) {
    const from = match[1];
    const to = match[6];
    const label = match[2] || match[3] || match[4] || match[5] || undefined;
    if (from && to) return { from, to, label: label?.trim() };
  }

  // Simpler fallback: look for ID (some arrow pattern) ID
  const simpleMatch = line.match(/^([A-Za-z_]\w*)\s+[-=.]+[->|]+.*?\s+([A-Za-z_]\w*)\s*$/);
  if (simpleMatch) {
    return { from: simpleMatch[1], to: simpleMatch[2] };
  }

  // Even more permissive: any line with an arrow between two identifiers
  const permissiveMatch = line.match(/([A-Za-z_]\w*)\s*[-=.]*(?:->|-->|==>|-\.->|---)[-=.>]*(?:\|[^|]*\|)?\s*([A-Za-z_]\w*)/);
  if (permissiveMatch) {
    return { from: permissiveMatch[1], to: permissiveMatch[2] };
  }

  return null;
}

/** Check if a nodeId is defined inside a child subgraph (not at the current scope level). */
function isInsideChildSubgraph(
  parent: SubgraphNode,
  nodeId: string,
  allFlat: Map<string, SubgraphNode>
): boolean {
  for (const child of parent.children) {
    if (getAllNodesInSubgraph(child, allFlat).has(nodeId)) return true;
  }
  return false;
}

/** Recursively collect all node IDs inside a subgraph and its descendants. */
export function getAllNodesInSubgraph(
  sg: SubgraphNode,
  allFlat: Map<string, SubgraphNode>
): Set<string> {
  const result = new Set<string>(sg.directNodes);
  for (const child of sg.children) {
    for (const nid of getAllNodesInSubgraph(child, allFlat)) {
      result.add(nid);
    }
    result.add(child.id); // the subgraph ID itself counts as "inside"
  }
  return result;
}

// ── Scope Path & Ancestor Lookup ─────────────────────────────────

/**
 * Get the breadcrumb path from root to a given scope.
 * Returns an array of { id, label } pairs, ending with the target scope.
 */
export function getScopePath(
  ast: MermaidAST,
  scopeId: string
): Array<{ id: string; label: string }> {
  const path: Array<{ id: string; label: string }> = [];
  let current = ast.allSubgraphsFlat.get(scopeId);
  while (current) {
    path.unshift({ id: current.id, label: current.label });
    current = current.parentId ? ast.allSubgraphsFlat.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * Find the nearest still-existing ancestor of a scope that no longer exists.
 * Returns null if no ancestor exists (fall back to root).
 */
export function findNearestAncestor(
  ast: MermaidAST,
  oldScopePath: Array<{ id: string; label: string }>
): string | null {
  // Walk the old path from deepest to shallowest, find first that still exists
  for (let i = oldScopePath.length - 1; i >= 0; i--) {
    if (ast.allSubgraphsFlat.has(oldScopePath[i].id)) {
      return oldScopePath[i].id;
    }
  }
  return null; // fall back to root
}

// ── Boundary Reference Detection ─────────────────────────────────

/**
 * Find all edges that cross the boundary of a given scope.
 */
export function getBoundaryRefs(ast: MermaidAST, scopeId: string): BoundaryRef[] {
  const sg = ast.allSubgraphsFlat.get(scopeId);
  if (!sg) return [];

  const insideNodes = getAllNodesInSubgraph(sg, ast.allSubgraphsFlat);
  // Also include child subgraph IDs as "inside"
  for (const child of sg.children) {
    insideNodes.add(child.id);
  }

  const refs: BoundaryRef[] = [];

  for (let i = 0; i < ast.edges.length; i++) {
    const edge = ast.edges[i];
    const fromInside = insideNodes.has(edge.from) || sg.id === edge.from;
    const toInside = insideNodes.has(edge.to) || sg.id === edge.to;

    if (fromInside && !toInside) {
      refs.push({
        edgeIndex: i,
        direction: "outgoing",
        insideNodeId: edge.from,
        externalNodeId: edge.to,
        externalLabel: findNodeLabel(ast, edge.to),
        rawLine: edge.rawLine,
      });
    } else if (!fromInside && toInside) {
      refs.push({
        edgeIndex: i,
        direction: "incoming",
        insideNodeId: edge.to,
        externalNodeId: edge.from,
        externalLabel: findNodeLabel(ast, edge.from),
        rawLine: edge.rawLine,
      });
    }
  }

  return refs;
}

/** Try to find the display label for a node from the source. */
function findNodeLabel(ast: MermaidAST, nodeId: string): string {
  for (const line of ast.lines) {
    const trimmed = line.trim();
    const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(
      new RegExp(`^${escaped}\\s*[\\[\\(\\{<"]([^\\]\\)\\}>"]*)`)
    );
    if (match) {
      // Strip HTML tags from labels
      return match[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim() || nodeId;
    }
  }
  return nodeId;
}

// ── View Code Generation ─────────────────────────────────────────

/**
 * Generate Mermaid code for the ROOT view.
 * Subgraphs are collapsed into single compound nodes.
 */
export function getRootViewCode(ast: MermaidAST): string {
  const output: string[] = [ast.headerLine];

  // Collect classDef and class lines from source
  const styleLines: string[] = [];
  for (const line of ast.lines) {
    const trimmed = line.trim();
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed) || /^style\s/i.test(trimmed)) {
      styleLines.push(line);
    }
  }

  // Emit root-level node definitions
  for (const line of ast.lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    if (/^(flowchart|graph)\s/i.test(trimmed)) continue;
    if (/^subgraph\s/i.test(trimmed)) continue;
    if (/^end\s*$/i.test(trimmed)) continue;
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed) || /^style\s/i.test(trimmed)) continue;
    if (/^click\s/i.test(trimmed) || /^linkStyle\s/i.test(trimmed)) continue;
    if (/^direction\s/i.test(trimmed)) continue;

    // Check if this line is inside a subgraph
    const lineIdx = ast.lines.indexOf(line);
    if (isLineInsideSubgraph(lineIdx, ast)) continue;

    output.push(line);
  }

  // Emit compound nodes for top-level subgraphs
  for (const sg of ast.subgraphs) {
    output.push(`    ${sg.id}[["${sg.label}"]]:::compoundNode`);
  }

  // Emit edges that connect root-level items
  // (Edges between a root node and a subgraph ID, or between root nodes)
  const rootNodeSet = new Set(ast.rootNodes);
  const topSgIds = new Set(ast.subgraphs.map(s => s.id));

  for (const edge of ast.edges) {
    const fromIsRoot = rootNodeSet.has(edge.from) || topSgIds.has(edge.from);
    const toIsRoot = rootNodeSet.has(edge.to) || topSgIds.has(edge.to);

    // Check if from/to is inside a subgraph but the edge connects at the subgraph level
    const fromSgOwner = findOwnerSubgraph(edge.from, ast);
    const toSgOwner = findOwnerSubgraph(edge.to, ast);

    if (fromIsRoot && toIsRoot) {
      // Both at root level — keep edge as-is
      output.push(edge.rawLine);
    } else if (fromIsRoot && toSgOwner && !toIsRoot) {
      // Edge from root to inside a top-level subgraph → redirect to subgraph compound node
      const topParent = getTopLevelParent(toSgOwner, ast);
      if (topParent) {
        const arrow = extractArrow(edge.rawLine);
        output.push(`    ${edge.from} ${arrow} ${topParent}`);
      }
    } else if (toIsRoot && fromSgOwner && !fromIsRoot) {
      // Edge from inside a subgraph to root → redirect from subgraph compound node
      const topParent = getTopLevelParent(fromSgOwner, ast);
      if (topParent) {
        const arrow = extractArrow(edge.rawLine);
        output.push(`    ${topParent} ${arrow} ${edge.to}`);
      }
    } else if (fromSgOwner && toSgOwner && fromSgOwner !== toSgOwner) {
      // Cross-subgraph edge — connect the two top-level compound nodes
      const topFrom = getTopLevelParent(fromSgOwner, ast);
      const topTo = getTopLevelParent(toSgOwner, ast);
      if (topFrom && topTo && topFrom !== topTo) {
        const arrow = extractArrow(edge.rawLine);
        output.push(`    ${topFrom} ${arrow} ${topTo}`);
      }
    }
  }

  // Add compound node class definition
  output.push(`    classDef compoundNode fill:#E6D6FF,stroke:#7B2CBF,stroke-width:2.5px,color:#2D0A4B,stroke-dasharray:8 4`);

  // Re-append original style lines
  for (const sl of styleLines) {
    output.push(sl);
  }

  return deduplicateEdges(output).join("\n");
}

/**
 * Generate Mermaid code for a SPECIFIC SCOPE view.
 * Includes direct nodes, child subgraphs (collapsed), and boundary stubs.
 */
export function getScopeViewCode(ast: MermaidAST, scopeId: string): {
  code: string;
  boundaryNodeIds: string[];
} {
  const sg = ast.allSubgraphsFlat.get(scopeId);
  if (!sg) return { code: ast.headerLine + "\n    A[Scope not found]", boundaryNodeIds: [] };

  const output: string[] = [ast.headerLine];
  const boundaryNodeIds: string[] = [];

  // Emit lines from the subgraph body (between sourceStart+1 and sourceEnd-1)
  // but skip nested subgraph internals (only keep the subgraph/end markers for child subgraphs)
  const innerStart = sg.sourceStart + 1;
  const innerEnd = sg.sourceEnd;
  const childRanges = sg.children.map(c => ({ start: c.sourceStart, end: c.sourceEnd, id: c.id, label: c.label }));

  for (let i = innerStart; i < innerEnd; i++) {
    const trimmed = ast.lines[i].trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    if (/^direction\s/i.test(trimmed)) continue;
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed) || /^style\s/i.test(trimmed)) continue;
    if (/^click\s/i.test(trimmed) || /^linkStyle\s/i.test(trimmed)) continue;

    // Check if this line is inside a child subgraph's body
    const childRange = childRanges.find(cr => i >= cr.start && i <= cr.end);
    if (childRange) {
      // Skip the child subgraph's internals — we'll emit it as a compound node
      if (i === childRange.start) {
        // Emit compound node instead of the subgraph block
        output.push(`    ${childRange.id}[["${childRange.label}"]]:::compoundNode`);
      }
      // Skip all other lines inside the child subgraph
      continue;
    }

    output.push(ast.lines[i]);
  }

  // Emit edges internal to this scope
  const insideNodes = new Set(sg.directNodes);
  for (const child of sg.children) {
    insideNodes.add(child.id);
  }

  // Add boundary reference stubs
  const boundaryRefs = getBoundaryRefs(ast, scopeId);
  const addedExternalNodes = new Set<string>();

  for (const ref of boundaryRefs) {
    const extId = `_ext_${ref.externalNodeId}`;
    if (!addedExternalNodes.has(ref.externalNodeId)) {
      addedExternalNodes.add(ref.externalNodeId);
      // Emit greyed-out stub node
      const safeLabel = ref.externalLabel.replace(/"/g, "'");
      output.push(`    ${extId}["${safeLabel}"]:::externalRef`);
      boundaryNodeIds.push(extId);
    }

    // Emit the boundary edge
    if (ref.direction === "incoming") {
      output.push(`    ${extId} -.-> ${ref.insideNodeId}`);
    } else {
      output.push(`    ${ref.insideNodeId} -.-> ${extId}`);
    }
  }

  // Add class definitions
  output.push(`    classDef compoundNode fill:#E6D6FF,stroke:#7B2CBF,stroke-width:2.5px,color:#2D0A4B,stroke-dasharray:8 4`);
  output.push(`    classDef externalRef fill:#E5E5E5,stroke:#9A9A9A,stroke-width:1px,color:#666666,stroke-dasharray:5 3`);

  return { code: output.join("\n"), boundaryNodeIds };
}

// ── Scoped Code Extraction (for Export) ──────────────────────────

/**
 * Extract the Mermaid code for a scope and ALL its descendants.
 * Used for "Copy Current Scope" export.
 */
export function extractScopeCode(ast: MermaidAST, scopeId: string): string {
  const sg = ast.allSubgraphsFlat.get(scopeId);
  if (!sg) return "";

  const output: string[] = [ast.headerLine];

  // Include the subgraph block and everything inside it
  for (let i = sg.sourceStart; i <= sg.sourceEnd; i++) {
    output.push(ast.lines[i]);
  }

  // Include edges that are fully internal to this scope
  const allInsideNodes = getAllNodesInSubgraph(sg, ast.allSubgraphsFlat);
  for (const edge of ast.edges) {
    if (edge.lineIndex > sg.sourceStart && edge.lineIndex < sg.sourceEnd) continue; // already included
    if (allInsideNodes.has(edge.from) && allInsideNodes.has(edge.to)) {
      output.push(edge.rawLine);
    }
  }

  // Include any classDef/class lines from the original
  for (const line of ast.lines) {
    const trimmed = line.trim();
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed)) {
      output.push(line);
    }
  }

  return output.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────

/** Check if a line index falls inside any subgraph. */
function isLineInsideSubgraph(lineIdx: number, ast: MermaidAST): boolean {
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (lineIdx > sg.sourceStart && lineIdx < sg.sourceEnd) return true;
  }
  return false;
}

/** Find which subgraph (if any) directly contains a given node ID. */
function findOwnerSubgraph(nodeId: string, ast: MermaidAST): string | null {
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (sg.directNodes.includes(nodeId)) return sg.id;
  }
  return null;
}

/** Walk up to the top-level subgraph parent of a given subgraph. */
function getTopLevelParent(sgId: string, ast: MermaidAST): string | null {
  let current = ast.allSubgraphsFlat.get(sgId);
  if (!current) return sgId; // it's a node, not a subgraph
  while (current.parentId) {
    const parent = ast.allSubgraphsFlat.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

/** Extract the arrow syntax from an edge line (e.g., "-->", "-.->", "==>"). */
function extractArrow(rawLine: string): string {
  const m = rawLine.match(/([-=.]+>|[-=.]+[->]+)/);
  return m ? m[1] : "-->";
}

/** Remove duplicate edges from the output lines. */
function deduplicateEdges(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Only deduplicate edge-like lines
    const isEdge = /[A-Za-z_]\w*\s+[-=.]+[->]/.test(trimmed);
    if (isEdge) {
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
    }
    result.push(line);
  }
  return result;
}

/**
 * Find the scope that directly owns a given node ID.
 * Returns the subgraph ID, or null if the node is at root level.
 */
export function findNodeScope(ast: MermaidAST, nodeId: string): string | null {
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (sg.directNodes.includes(nodeId)) return sg.id;
  }
  return null;
}
