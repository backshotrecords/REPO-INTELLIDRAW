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

    // Detect subgraph start — ID capture stops at whitespace or '[' to handle
    // both `subgraph ID[Label]` (no space) and `subgraph ID [Label]` (with space)
    const sgMatch = trimmed.match(/^subgraph\s+([^\s[]+)(?:\s*\[([^\]]*)\])?/i);
    if (sgMatch) {
      const sgId = sgMatch[1];
      // Label: either the bracketed label, or the ID itself, or text after ID
      let sgLabel = sgMatch[2] || "";
      if (!sgLabel) {
        // Check for `subgraph ID text here` pattern (label without brackets)
        const altMatch = trimmed.match(/^subgraph\s+([^\s[]+)\s+(.+)$/i);
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

    // Detect edges — patterns like A --> B, A --> B --> C (chains), A -->|label| B
    const allEdges = parseAllEdges(trimmed);
    if (allEdges.length > 0) {
      for (const edgeMatch of allEdges) {
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
 * Handles all common arrow styles: -->, -.->, ==>, -->|label|, etc.
 * Also handles inline node definitions: A --> B[label], A --> DEC{choice}, etc.
 *
 * Strategy: find the arrow, skip any |label|, grab the ID on each side.
 */
interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  arrow: string;
  rawLine: string;
}

/**
 * Parse ALL edges from a line, handling chains like `A --> B --> C`.
 * Returns an array of edges (empty if no edges found).
 */
function parseAllEdges(line: string): ParsedEdge[] {
  const edges: ParsedEdge[] = [];
  const arrowRegex = /([-=.]{2,}>|~{3,})/g;
  const arrowMatches: Array<{ index: number; end: number; arrow: string }> = [];
  let m;

  while ((m = arrowRegex.exec(line)) !== null) {
    arrowMatches.push({ index: m.index, end: m.index + m[0].length, arrow: m[0] });
  }

  if (arrowMatches.length === 0) return edges;

  // Get FROM of the first edge: first ID before the first arrow
  const beforeFirst = line.substring(0, arrowMatches[0].index);
  const firstFrom = beforeFirst.match(/([A-Za-z_]\w*)/);
  if (!firstFrom) return edges;

  let currentFrom = firstFrom[1];

  for (let i = 0; i < arrowMatches.length; i++) {
    const arr = arrowMatches[i];
    const afterArrow = line.substring(arr.end);

    // Extract TO (first ID after arrow, skipping optional |label|)
    const toMatch = afterArrow.match(/^(?:\s*\|[^|]*\|)?\s*([A-Za-z_]\w*)/);
    if (!toMatch) break;

    // Extract label if present
    const labelMatch = afterArrow.match(/^\s*\|([^|]*)\|/);
    const label = labelMatch ? labelMatch[1].trim() : undefined;

    edges.push({ from: currentFrom, to: toMatch[1], label, arrow: arr.arrow, rawLine: line });

    // Chain: this edge's TO becomes the next edge's FROM
    currentFrom = toMatch[1];
  }

  return edges;
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

/** Find which child subgraph (if any) contains a given node. Returns the child subgraph ID or null. */
function findChildContaining(
  nodeId: string,
  parent: SubgraphNode,
  allFlat: Map<string, SubgraphNode>
): string | null {
  for (const child of parent.children) {
    if (getAllNodesInSubgraph(child, allFlat).has(nodeId)) return child.id;
  }
  return null;
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
    // Skip invisible links (~~~) — they're layout-only, not semantic connections
    if (/~{3,}/.test(edge.rawLine)) continue;
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
    // Match nodeId followed by a shape bracket, anywhere in the line
    // (handles inline definitions like `INTRO --> DEC{Decision node}`)
    const match = trimmed.match(
      new RegExp(`(?:^|\\s|>)\\s*${escaped}\\s*([\\[\\(\\{<"])([^\\]\\)\\}>"]*)`)
    );
    if (match) {
      // Strip HTML tags from labels
      return match[2].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim() || nodeId;
    }
  }
  return nodeId;
}

/**
 * Find the original Mermaid shape brackets for a node (e.g., `[(` `)` for database).
 * Returns { open, close } bracket strings to preserve visual shape in boundary stubs.
 */
function findNodeShapeBrackets(ast: MermaidAST, nodeId: string): { open: string; close: string } {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const line of ast.lines) {
    const trimmed = line.trim();
    // Find nodeId followed by shape opener
    const match = trimmed.match(
      new RegExp(`(?:^|\\s|>)\\s*${escaped}\\s*([\\[\\(\\{>])`)
    );
    if (!match) continue;

    const opener = match[1];
    // Determine multi-char bracket by checking the char after the opener
    const openerPos = trimmed.indexOf(match[0]) + match[0].length - 1;
    const next = trimmed[openerPos + 1] || '';

    if (opener === '[') {
      if (next === '(') return { open: '[(', close: ')]' };   // database/cylinder
      if (next === '[') return { open: '[[', close: ']]' };   // subroutine
      if (next === '/') return { open: '[/', close: '/]' };   // parallelogram
      if (next === '\\') return { open: '[\\', close: '\\]' };
      if (next === '"') return { open: '["', close: '"]' };   // quoted
      return { open: '[', close: ']' };                        // standard square
    }
    if (opener === '(') {
      if (next === '[') return { open: '([', close: '])' };   // stadium
      if (next === '(') return { open: '((', close: '))' };   // circle
      return { open: '(', close: ')' };                        // rounded
    }
    if (opener === '{') {
      if (next === '{') return { open: '{{', close: '}}' };   // hexagon
      return { open: '{', close: '}' };                        // diamond
    }
    if (opener === '>') return { open: '>', close: ']' };      // asymmetric
  }

  return { open: '["', close: '"]' }; // fallback: quoted square
}

/**
 * Generate Mermaid code for the ROOT view.
 * Subgraphs are collapsed into single compound nodes.
 *
 * LINE-WALK approach: walks the original source lines and passes them through
 * unchanged, except for:
 *   - Subgraph blocks → replaced with a compound node line
 *   - Edge lines referencing nodes inside subgraphs → redirected to subgraph ID
 *   - class/style lines referencing collapsed nodes → filtered out
 * Everything else (node definitions, comments, etc.) stays exactly as written.
 */
export function getRootViewCode(ast: MermaidAST): string {
  if (ast.subgraphs.length === 0) {
    return ast.lines.join("\n");
  }

  const output: string[] = [];

  // Set of node IDs visible at root: root-level nodes + top-level subgraph IDs
  const rootNodeSet = new Set(ast.rootNodes);
  const topSgIds = new Set(ast.subgraphs.map(s => s.id));
  const visibleAtRoot = new Set([...rootNodeSet, ...topSgIds]);

  // Build a quick lookup: top-level subgraph line ranges
  const topSgRanges = ast.subgraphs
    .filter(sg => sg.sourceEnd >= 0) // skip incomplete subgraphs (no 'end' yet)
    .map(sg => ({
      start: sg.sourceStart,
      end: sg.sourceEnd,
      id: sg.id,
      label: sg.label,
    }));

  // Edge deduplication for redirected cross-subgraph edges
  const emittedRedirectedEdges = new Set<string>();

  for (let i = 0; i < ast.lines.length; i++) {
    const trimmed = ast.lines[i].trim();

    // Check if this line starts a top-level subgraph block
    const sgRange = topSgRanges.find(r => i === r.start);
    if (sgRange) {
      // Emit a compound node in place of the entire subgraph block
      const safeLabel = sgRange.label.replace(/"/g, "'");
      output.push(`    ${sgRange.id}["\uD83D\uDCC2 ${safeLabel}"]`);
      // Skip all lines until the matching 'end'
      i = sgRange.end;
      continue;
    }

    // Safety: skip if somehow inside a subgraph
    if (isLineInsideSubgraph(i, ast)) continue;

    // Handle edge lines: check if endpoints need redirecting (supports chains)
    const chainEdges = parseAllEdges(trimmed);
    if (chainEdges.length > 0) {
      // If ALL endpoints in the chain are visible at root, pass through as-is
      const allVisible = chainEdges.every(e =>
        visibleAtRoot.has(e.from) && visibleAtRoot.has(e.to)
      );

      if (allVisible) {
        output.push(ast.lines[i]);
      } else {
        // Skip invisible links (~~~)
        if (/~{3,}/.test(ast.lines[i])) { /* skip entire line */ }
        else {
          // Split chain into individual edges and redirect each
          for (const edgeParsed of chainEdges) {
            let fromId = edgeParsed.from;
            let toId = edgeParsed.to;

            if (!visibleAtRoot.has(fromId)) {
              const owner = findOwnerSubgraph(fromId, ast);
              fromId = owner ? (getTopLevelParent(owner, ast) || fromId) : fromId;
            }
            if (!visibleAtRoot.has(toId)) {
              const owner = findOwnerSubgraph(toId, ast);
              toId = owner ? (getTopLevelParent(owner, ast) || toId) : toId;
            }

            if (fromId === toId) continue;

            const edgeKey = `${fromId}-->${toId}`;
            if (emittedRedirectedEdges.has(edgeKey)) continue;
            emittedRedirectedEdges.add(edgeKey);

            const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
            output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
          }
        }
      }
      continue;
    }

    // class lines: only emit if ALL referenced nodes are visible at root
    if (/^class\s/i.test(trimmed)) {
      const classMatch = trimmed.match(/^class\s+(.+?)\s+\S+$/i);
      if (classMatch) {
        const nodeIds = classMatch[1].split(',').map(s => s.trim());
        if (nodeIds.every(id => visibleAtRoot.has(id))) {
          output.push(ast.lines[i]);
        }
      }
      continue;
    }

    // style lines: only emit if the referenced node is visible at root
    if (/^style\s/i.test(trimmed)) {
      const styleMatch = trimmed.match(/^style\s+(\S+)/i);
      if (styleMatch && visibleAtRoot.has(styleMatch[1])) {
        output.push(ast.lines[i]);
      }
      continue;
    }

    // Everything else — pass through unchanged
    // (header, comments, node definitions, classDef, linkStyle, etc.)
    output.push(ast.lines[i]);
  }

  return output.join("\n");
}

/**
 * Generate Mermaid code for a SPECIFIC SCOPE view.
 * Includes direct nodes, child subgraphs (collapsed), and boundary stubs.
 * ONLY emits edges where both endpoints are valid in this scope view.
 */
export function getScopeViewCode(ast: MermaidAST, scopeId: string): {
  code: string;
  boundaryNodeIds: string[];
} {
  const sg = ast.allSubgraphsFlat.get(scopeId);
  if (!sg) return { code: ast.headerLine + "\n    A[Scope not found]", boundaryNodeIds: [] };

  const output: string[] = [ast.headerLine];
  const boundaryNodeIds: string[] = [];

  // Build the set of node IDs visible in this scope
  const visibleNodes = new Set(sg.directNodes);
  for (const child of sg.children) {
    visibleNodes.add(child.id);
  }

  // Emit lines from the subgraph body (between sourceStart+1 and sourceEnd-1)
  // but skip nested subgraph internals and cross-scope edge lines
  const innerStart = sg.sourceStart + 1;
  const innerEnd = sg.sourceEnd;
  const childRanges = sg.children.map(c => ({ start: c.sourceStart, end: c.sourceEnd, id: c.id, label: c.label }));
  const scopeRedirectedEdges = new Set<string>();

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
        const safeLabel = childRange.label.replace(/"/g, "'");
        output.push(`    ${childRange.id}["\uD83D\uDCC2 ${safeLabel}"]`);
      }
      continue;
    }

    // Check if this is an edge line (supports chains)
    const chainEdges = parseAllEdges(trimmed);
    if (chainEdges.length > 0) {
      // If ALL endpoints visible in scope, pass through as-is
      const allVisible = chainEdges.every(e =>
        visibleNodes.has(e.from) && visibleNodes.has(e.to)
      );

      if (allVisible) {
        output.push(ast.lines[i]);
      } else {
        // Split chain and redirect individual edges where endpoints are in child subgraphs
        for (const edgeParsed of chainEdges) {
          let fromId = edgeParsed.from;
          let toId = edgeParsed.to;
          const fromVis = visibleNodes.has(fromId);
          const toVis = visibleNodes.has(toId);

          if (fromVis && toVis) {
            // This segment is fully internal — emit with its arrow + label
            const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
            output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
            continue;
          }

          let hasRedirect = false;
          if (!fromVis) {
            const childOwner = findChildContaining(edgeParsed.from, sg, ast.allSubgraphsFlat);
            if (childOwner) { fromId = childOwner; hasRedirect = true; }
          }
          if (!toVis) {
            const childOwner = findChildContaining(edgeParsed.to, sg, ast.allSubgraphsFlat);
            if (childOwner) { toId = childOwner; hasRedirect = true; }
          }

          if (hasRedirect && fromId !== toId) {
            if (!/~{3,}/.test(ast.lines[i])) {
              const edgeKey = `${fromId}-->${toId}`;
              if (!scopeRedirectedEdges.has(edgeKey)) {
                scopeRedirectedEdges.add(edgeKey);
                const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
                output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
              }
            }
          }
        }
        // Truly external edges handled below by boundary ref logic
      }
      continue;
    }

    output.push(ast.lines[i]);
  }

  // Add boundary reference stubs for cross-scope edges
  const boundaryRefs = getBoundaryRefs(ast, scopeId);
  const addedExternalNodes = new Set<string>();

  for (const ref of boundaryRefs) {
    // Skip refs where the inside endpoint is the scope itself
    // (e.g., `A --> B` where B is the current scope — this is the container, not an inner node)
    if (ref.insideNodeId === scopeId) continue;

    const extId = `_ext_${ref.externalNodeId}`;
    if (!addedExternalNodes.has(ref.externalNodeId)) {
      addedExternalNodes.add(ref.externalNodeId);
      // Emit stub node preserving original shape (CSS handles the washed-out styling)
      const safeLabel = ref.externalLabel.replace(/"/g, "'");
      const shape = findNodeShapeBrackets(ast, ref.externalNodeId);
      output.push(`    ${extId}${shape.open}${safeLabel}${shape.close}`);
      boundaryNodeIds.push(extId);
    }

    // Emit the boundary edge (dotted)
    if (ref.direction === "incoming") {
      output.push(`    ${extId} -.-> ${ref.insideNodeId}`);
    } else {
      output.push(`    ${ref.insideNodeId} -.-> ${extId}`);
    }
  }

  // Emit classDef/class/style lines from the FULL source that apply to visible nodes.
  // classDef lines define styles (safe to always emit).
  // class/style lines reference specific nodes — only emit for visible ones.
  for (let i = 0; i < ast.lines.length; i++) {
    const trimmed = ast.lines[i].trim();

    // classDef lines are safe — they only DEFINE styles, don't reference nodes
    if (/^classDef\s/i.test(trimmed)) {
      output.push(ast.lines[i]);
      continue;
    }

    // class lines reference specific nodes: `class A,B,C className`
    // Only emit if ALL referenced nodes are visible in this scope
    if (/^class\s/i.test(trimmed)) {
      const classMatch = trimmed.match(/^class\s+(.+?)\s+\S+$/i);
      if (classMatch) {
        const nodeIds = classMatch[1].split(',').map(s => s.trim());
        const allVisible = nodeIds.every(id => visibleNodes.has(id));
        if (allVisible) {
          output.push(ast.lines[i]);
        }
      }
      continue;
    }

    // style lines reference a specific node: `style A fill:...`
    if (/^style\s/i.test(trimmed)) {
      const styleMatch = trimmed.match(/^style\s+(\S+)/i);
      if (styleMatch && visibleNodes.has(styleMatch[1])) {
        output.push(ast.lines[i]);
      }
    }
  }

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
