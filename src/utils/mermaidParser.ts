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
  titleOnly: boolean;            // declared without an explicit ID (synthetic ID minted from the title)
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
  arrow: string;
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
  const nodeOwners = new Map<string, string | null>();
  const explicitNodeOwners = new Map<string, string | null>();
  // Bare membership lines may name a subgraph declared later (Mermaid's
  // membership-by-reference nests that group); resolved in a post-pass.
  const pendingGroupAdoptions: Array<{ childId: string; parentId: string }> = [];

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

    // Detect subgraph start. Mermaid allows either explicit IDs
    // (`subgraph S [Group S]`) or a title-only declaration with spaces
    // (`subgraph Launch Strategy`). Title-only groups need synthetic IDs so
    // collapse state does not collide on the first word.
    const sgDecl = parseSubgraphDeclaration(trimmed, allSubgraphsFlat);
    if (sgDecl) {
      const { id: sgId, label: sgLabel } = sgDecl;

      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      const node: SubgraphNode = {
        id: sgId,
        label: sgLabel,
        parentId,
        children: [],
        sourceStart: i,
        sourceEnd: -1, // filled in when we find the matching "end"
        directNodes: [],
        titleOnly: sgDecl.titleOnly,
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

    // Mermaid supports declaring group membership after node/edge definitions:
    // `subgraph Group` followed by bare `NodeId` lines.
    const bareMembershipMatch = trimmed.match(/^([A-Za-z_]\w*)$/);
    if (bareMembershipMatch && stack.length > 0) {
      const memberId = bareMembershipMatch[1];
      const scope = stack[stack.length - 1];
      pendingGroupAdoptions.push({ childId: memberId, parentId: scope.id });
      if (!allSubgraphsFlat.has(memberId)) {
        recordNodeMembership(memberId, scope);
      }
      continue;
    }

    // Detect edges — patterns like A --> B, A --> B --> C (chains), A -->|label| B
    const allEdges = parseAllEdges(trimmed);
    if (allEdges.length > 0) {
      for (const edgeMatch of allEdges) {
        edges.push({
          from: edgeMatch.from,
          to: edgeMatch.to,
          label: edgeMatch.label,
          arrow: edgeMatch.arrow,
          lineIndex: i,
          rawLine: lines[i],
        });

        // Assign nodes to current scope
        const currentScope = stack.length > 0 ? stack[stack.length - 1] : null;
        recordNodeReference(edgeMatch.from, currentScope, hasInlineNodeDefinition(trimmed, edgeMatch.from));
        recordNodeReference(edgeMatch.to, currentScope, hasInlineNodeDefinition(trimmed, edgeMatch.to));
      }
      continue;
    }

    // Detect standalone node definitions — ID[label], ID(label), ID{label}, etc.
    const nodeDefMatch = trimmed.match(/^([A-Za-z_]\w*)\s*[\[({<"]/);
    if (nodeDefMatch) {
      const nodeId = nodeDefMatch[1];
      const currentScope = stack.length > 0 ? stack[stack.length - 1] : null;
      recordNodeReference(nodeId, currentScope, true);
    }
  }

  // ── Post-pass: reconcile IDs that turned out to be subgraphs ──
  // A bare membership line naming a group (declared before or after the line)
  // nests that group under the referencing scope, matching Mermaid's
  // membership-by-reference.
  for (const { childId, parentId } of pendingGroupAdoptions) {
    const child = allSubgraphsFlat.get(childId);
    const parent = allSubgraphsFlat.get(parentId);
    if (!child || !parent || child.parentId === parentId) continue;
    if (isSelfOrDescendant(parentId, childId)) continue; // cycle guard
    if (child.parentId && allSubgraphsFlat.has(child.parentId)) {
      const oldParent = allSubgraphsFlat.get(child.parentId)!;
      oldParent.children = oldParent.children.filter(c => c !== child);
    } else {
      const idx = topLevelSubgraphs.indexOf(child);
      if (idx >= 0) topLevelSubgraphs.splice(idx, 1);
    }
    child.parentId = parentId;
    parent.children.push(child);
  }

  // Edge/membership references recorded before a subgraph declaration was
  // reached may have captured the subgraph ID as a plain node — subgraph IDs
  // are never member nodes.
  for (const sg of allSubgraphsFlat.values()) {
    sg.directNodes = sg.directNodes.filter(id => !allSubgraphsFlat.has(id));
  }
  for (const sgId of allSubgraphsFlat.keys()) {
    allDefinedNodes.delete(sgId);
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

  function recordNodeReference(
    nodeId: string,
    currentScope: SubgraphNode | null,
    isDefinition = false
  ): void {
    // Subgraph IDs are edge endpoints, never plain member nodes. Forward
    // references (subgraph declared later) are cleaned up in the post-pass.
    if (allSubgraphsFlat.has(nodeId)) return;
    allDefinedNodes.add(nodeId);

    const currentOwner = currentScope?.id ?? null;
    const existingOwner = nodeOwners.get(nodeId);
    const existingExplicitOwner = explicitNodeOwners.get(nodeId);

    if (isDefinition) {
      // References are provisional: `A --> B` may appear before `B[Label]`
      // later defines B inside its real scope. Once a definition exists, keep
      // that explicit owner stable so cross-scope edges do not steal it.
      if (existingExplicitOwner !== undefined && existingExplicitOwner !== currentOwner) {
        return;
      }

      if (existingOwner !== undefined && existingOwner !== currentOwner) {
        removeDirectNode(nodeId, existingOwner);
      }

      explicitNodeOwners.set(nodeId, currentOwner);
      nodeOwners.set(nodeId, currentOwner);

      if (!currentScope) return;
      if (isInsideChildSubgraph(currentScope, nodeId, allSubgraphsFlat)) return;
      if (!currentScope.directNodes.includes(nodeId)) {
        currentScope.directNodes.push(nodeId);
      }
      return;
    }

    if (existingOwner === undefined) {
      nodeOwners.set(nodeId, currentOwner);
    } else if (existingOwner !== currentOwner) {
      return;
    }

    if (!currentScope) return;
    if (isInsideChildSubgraph(currentScope, nodeId, allSubgraphsFlat)) return;
    if (!currentScope.directNodes.includes(nodeId)) {
      currentScope.directNodes.push(nodeId);
    }
  }

  function recordNodeMembership(nodeId: string, currentScope: SubgraphNode): void {
    if (allSubgraphsFlat.has(nodeId)) return;
    allDefinedNodes.add(nodeId);

    const currentOwner = currentScope.id;
    const existingOwner = nodeOwners.get(nodeId);
    const existingExplicitOwner = explicitNodeOwners.get(nodeId);

    if (
      existingExplicitOwner !== undefined &&
      existingExplicitOwner !== null &&
      existingExplicitOwner !== currentOwner
    ) {
      return;
    }

    if (existingOwner !== undefined && existingOwner !== currentOwner) {
      removeDirectNode(nodeId, existingOwner);
    }

    explicitNodeOwners.set(nodeId, currentOwner);
    nodeOwners.set(nodeId, currentOwner);

    if (isInsideChildSubgraph(currentScope, nodeId, allSubgraphsFlat)) return;
    if (!currentScope.directNodes.includes(nodeId)) {
      currentScope.directNodes.push(nodeId);
    }
  }

  function removeDirectNode(nodeId: string, ownerId: string | null): void {
    if (!ownerId) return;
    const owner = allSubgraphsFlat.get(ownerId);
    if (!owner) return;
    owner.directNodes = owner.directNodes.filter(id => id !== nodeId);
  }

  function isSelfOrDescendant(candidateId: string, ancestorId: string): boolean {
    let current: string | null = candidateId;
    while (current) {
      if (current === ancestorId) return true;
      current = allSubgraphsFlat.get(current)?.parentId ?? null;
    }
    return false;
  }
}

function parseSubgraphDeclaration(
  trimmed: string,
  allSubgraphsFlat: Map<string, SubgraphNode>
): { id: string; label: string; titleOnly: boolean } | null {
  const restMatch = trimmed.match(/^subgraph\s+(.+)$/i);
  if (!restMatch) return null;

  const rest = restMatch[1].trim();
  const explicitMatch = rest.match(/^([^\s[]+)\s*(?:\[(.*)\])?$/);

  if (explicitMatch) {
    const rawId = explicitMatch[1];
    const rawLabel = explicitMatch[2];
    const label = stripLabelQuotes(rawLabel ? rawLabel.trim() : rawId);
    return { id: ensureUniqueSubgraphId(rawId, allSubgraphsFlat), label, titleOnly: false };
  }

  const label = stripLabelQuotes(rest);
  return {
    id: ensureUniqueSubgraphId(labelToSubgraphId(label), allSubgraphsFlat),
    label,
    // Multi-word title with no explicit ID: our synthetic ID is unknown to
    // stock Mermaid, so passthrough views may need the declaration rewritten.
    titleOnly: true,
  };
}

export function normalizeMermaidDisplayLabel(label: string): string {
  return stripLabelQuotes(label)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLabelQuotes(label: string): string {
  return label.trim().replace(/^["']|["']$/g, "");
}

function labelToSubgraphId(label: string): string {
  const sanitized = label
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!sanitized) return "Subgraph";
  if (/^[0-9]/.test(sanitized)) return `Subgraph_${sanitized}`;
  return sanitized;
}

function ensureUniqueSubgraphId(
  baseId: string,
  allSubgraphsFlat: Map<string, SubgraphNode>
): string {
  const fallback = labelToSubgraphId(baseId);
  let candidate = fallback || "Subgraph";
  let suffix = 2;

  while (allSubgraphsFlat.has(candidate)) {
    candidate = `${fallback}_${suffix}`;
    suffix++;
  }

  return candidate;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasInlineNodeDefinition(line: string, nodeId: string): boolean {
  const escaped = escapeRegex(nodeId);
  return new RegExp(`(?:^|\\s|>)\\s*${escaped}\\s*[\\[\\(\\{<"]`).test(line);
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

    // Extract label if present. Mermaid supports A -->|label| B plus the
    // spaced forms A -- label -->, A -. label .->, and A == label ==> B;
    // normalize all of them for rewritten edges.
    const pipeLabelMatch = afterArrow.match(/^\s*\|([^|]*)\|/);
    const beforeArrow = line.substring(0, arr.index);
    const currentFromMatches = [...beforeArrow.matchAll(new RegExp(`\\b${escapeRegex(currentFrom)}\\b`, 'g'))];
    const afterCurrentFrom = currentFromMatches.length > 0
      ? beforeArrow.slice(currentFromMatches[currentFromMatches.length - 1].index! + currentFrom.length)
      : '';
    const spacedLabelMatch = afterCurrentFrom.match(/(?:--|-\.+|==)\s*([^-|][\s\S]*?)\s*$/);
    const label = pipeLabelMatch
      ? pipeLabelMatch[1].trim()
      : spacedLabelMatch?.[1].trim() || undefined;

    // The spaced dotted form `A -. text .->` tokenizes its closing arrow as
    // `.->`; normalize to the canonical `-.->` so re-emitted edges stay valid.
    const arrow = /^\.+->$/.test(arr.arrow) ? `-${arr.arrow}` : arr.arrow;

    edges.push({ from: currentFrom, to: toMatch[1], label, arrow, rawLine: line });

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
    path.unshift({ id: current.id, label: normalizeMermaidDisplayLabel(current.label) });
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
    const match = trimmed.match(new RegExp(`(?:^|\\s|>)\\s*${escaped}\\s*([\\[\\(\\{<"])`));
    if (!match || match.index === undefined) continue;

    const openerIndex = match.index + match[0].length - 1;
    const label = extractNodeLabelFromShape(trimmed, openerIndex);
    if (label) {
      return normalizeMermaidDisplayLabel(label) || nodeId;
    }
  }
  return nodeId;
}

function extractNodeLabelFromShape(line: string, openerIndex: number): string | null {
  const opener = line[openerIndex];
  const next = line[openerIndex + 1] || "";
  let contentStart = openerIndex + 1;
  let closeToken = "";

  if (opener === "[") {
    if (next === "(") {
      contentStart++;
      closeToken = ")]";
    } else if (next === "[") {
      contentStart++;
      closeToken = "]]";
    } else if (next === "/") {
      contentStart++;
      closeToken = "/]";
    } else if (next === "\\") {
      contentStart++;
      closeToken = "\\]";
    } else {
      closeToken = "]";
    }
  } else if (opener === "(") {
    if (next === "[") {
      contentStart++;
      closeToken = "])";
    } else if (next === "(") {
      contentStart++;
      closeToken = "))";
    } else {
      closeToken = ")";
    }
  } else if (opener === "{") {
    if (next === "{") {
      contentStart++;
      closeToken = "}}";
    } else {
      closeToken = "}";
    }
  } else if (opener === "<") {
    closeToken = ">";
  } else if (opener === "\"") {
    closeToken = "\"";
  } else {
    return null;
  }

  const closeIndex = findShapeClose(line, contentStart, closeToken);
  if (closeIndex < 0) return null;
  return line.slice(contentStart, closeIndex);
}

function findShapeClose(line: string, start: number, closeToken: string): number {
  let quote: string | null = null;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    const prev = line[i - 1];

    if ((ch === "\"" || ch === "'") && prev !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
      continue;
    }

    if (!quote && line.startsWith(closeToken, i)) {
      return i;
    }
  }
  return -1;
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

function emitRedirectedEdgesInRange(
  ast: MermaidAST,
  startLine: number,
  endLine: number,
  visibleNodes: Set<string>,
  emittedEdges: Set<string>,
  output: string[],
  resolveHiddenEndpoint: (nodeId: string) => string
): void {
  for (let i = startLine; i < endLine; i++) {
    const rawLine = ast.lines[i];
    if (/~{3,}/.test(rawLine)) continue;

    const chainEdges = parseAllEdges(rawLine.trim());
    for (const edgeParsed of chainEdges) {
      const fromId = visibleNodes.has(edgeParsed.from)
        ? edgeParsed.from
        : resolveHiddenEndpoint(edgeParsed.from);
      const toId = visibleNodes.has(edgeParsed.to)
        ? edgeParsed.to
        : resolveHiddenEndpoint(edgeParsed.to);

      if (fromId === toId) continue;
      if (!visibleNodes.has(fromId) || !visibleNodes.has(toId)) continue;

      const edgeKey = `${fromId}-->${toId}`;
      if (emittedEdges.has(edgeKey)) continue;
      emittedEdges.add(edgeKey);

      const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
      emitVisibleEndpointDefinitionsForRedirectedEdge(output, ast, edgeParsed, fromId, toId, visibleNodes);
      output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
    }
  }
}

function hasNodeDefinition(lines: string[], nodeId: string): boolean {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nodeDefRegex = new RegExp(`(?:^|\\s|>)\\s*${escaped}\\s*[\\[\\(\\{<"]`);
  return lines.some(line => nodeDefRegex.test(line.trim()));
}

function emitNodeDefinitionIfMissing(output: string[], ast: MermaidAST, nodeId: string): void {
  // Groups render as clusters or compound nodes — never emit a plain node
  // definition for one (hasNodeDefinition's regex matches `subgraph X[...]`
  // lines, which would create a node/cluster ID collision).
  if (ast.allSubgraphsFlat.has(nodeId)) return;
  if (hasNodeDefinition(output, nodeId)) return;
  if (!hasNodeDefinition(ast.lines, nodeId)) return;

  const safeLabel = findNodeLabel(ast, nodeId).replace(/"/g, "'");
  const shape = findNodeShapeBrackets(ast, nodeId);
  output.push(`    ${nodeId}${shape.open}${safeLabel}${shape.close}`);
}

function emitDirectNodeDefinitionsIfMissing(
  output: string[],
  ast: MermaidAST,
  sg: SubgraphNode,
  indent = "    "
): void {
  for (const nodeId of sg.directNodes) {
    if (hasNodeDefinition(output, nodeId)) continue;

    const safeLabel = findNodeLabel(ast, nodeId).replace(/"/g, "'");
    const shape = findNodeShapeBrackets(ast, nodeId);
    output.push(`${indent}${nodeId}${shape.open}${safeLabel}${shape.close}`);
  }
}

function emitVisibleEndpointDefinitionsForRedirectedEdge(
  output: string[],
  ast: MermaidAST,
  edgeParsed: ParsedEdge,
  fromId: string,
  toId: string,
  visibleNodes: Set<string>
): void {
  if (fromId === edgeParsed.from && visibleNodes.has(fromId)) {
    emitNodeDefinitionIfMissing(output, ast, fromId);
  }
  if (toId === edgeParsed.to && visibleNodes.has(toId)) {
    emitNodeDefinitionIfMissing(output, ast, toId);
  }
}

function isNodeWithinSubgraph(nodeId: string, scopeId: string, ast: MermaidAST): boolean {
  let currentId: string | null;

  if (nodeId === scopeId) return true;
  if (ast.allSubgraphsFlat.has(nodeId)) {
    currentId = nodeId;
  } else {
    currentId = findOwnerSubgraph(nodeId, ast);
  }

  while (currentId) {
    if (currentId === scopeId) return true;
    currentId = ast.allSubgraphsFlat.get(currentId)?.parentId ?? null;
  }

  return false;
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

  // Build a quick lookup: lexically top-level subgraph line ranges (includes
  // groups adopted via membership-by-reference, which stay lexically at root)
  const topSgRanges = getLexicalRootSubgraphs(ast)
    .map(sg => ({
      start: sg.sourceStart,
      end: sg.sourceEnd,
      id: sg.id,
      label: sg.label,
      adopted: sg.parentId !== null,
    }));

  // Edge deduplication for redirected cross-subgraph edges
  const emittedRedirectedEdges = new Set<string>();
  const redirectToTopLevel = (nodeId: string) => {
    const owner = findOwnerSubgraph(nodeId, ast);
    return owner ? (getTopLevelParent(owner, ast) || nodeId) : nodeId;
  };

  for (let i = 0; i < ast.lines.length; i++) {
    const trimmed = ast.lines[i].trim();

    // Check if this line starts a lexically top-level subgraph block
    const sgRange = topSgRanges.find(r => i === r.start);
    if (sgRange) {
      if (sgRange.adopted) {
        // Adopted group: hidden inside its adopter's compound at root \u2014
        // skip the block, redirect its cross-boundary edges.
        emitRedirectedEdgesInRange(
          ast,
          sgRange.start + 1,
          sgRange.end,
          visibleAtRoot,
          emittedRedirectedEdges,
          output,
          redirectToTopLevel
        );
        i = sgRange.end;
        continue;
      }
      // Emit a compound node in place of the entire subgraph block
      const safeLabel = sgRange.label.replace(/"/g, "'");
      output.push(`    ${sgRange.id}["\uD83D\uDCC2 ${safeLabel}"]`);
      emitRedirectedEdgesInRange(
        ast,
        sgRange.start + 1,
        sgRange.end,
        visibleAtRoot,
        emittedRedirectedEdges,
        output,
        redirectToTopLevel
      );
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
            emitVisibleEndpointDefinitionsForRedirectedEdge(output, ast, edgeParsed, fromId, toId, visibleAtRoot);
            output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
          }
        }
      }
      continue;
    }

    // class lines: emit for the subset of referenced nodes visible at root
    if (/^class\s/i.test(trimmed)) {
      const classMatch = trimmed.match(/^class\s+(.+?)\s+(\S+)$/i);
      if (classMatch) {
        const visibleIds = classMatch[1].split(',').map(s => s.trim())
          .filter(id => visibleAtRoot.has(id));
        if (visibleIds.length > 0) {
          output.push(`    class ${visibleIds.join(',')} ${classMatch[2]}`);
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
 * Generate Mermaid code for the ROOT view with PARTIAL collapse state.
 * Some subgraphs are collapsed (compound nodes), others are expanded (pass through).
 *
 * LINE-WALK approach (same as getRootViewCode) but with hybrid handling:
 *   - Collapsed subgraphs → replaced with a compound node line
 *   - Expanded subgraphs → original subgraph...end block passes through unchanged
 *   - Edge lines → redirect endpoints inside COLLAPSED groups; keep EXPANDED as-is
 *   - class/style lines → filtered for visible nodes only
 *
 * Short-circuits to raw code when collapsedSubgraphIds is empty (zero overhead default).
 */
export function getRootViewWithCollapseState(
  ast: MermaidAST,
  collapsedSubgraphIds: Set<string>
): { code: string; compoundNodeIds: string[] } {
  const declRewrites = buildDeclarationRewrites(ast);
  const sourceLine = (i: number) => declRewrites.get(i) ?? ast.lines[i];

  // Short-circuit: nothing collapsed → return raw code (with title-only
  // declarations rewritten where edges reference their synthetic IDs)
  if (collapsedSubgraphIds.size === 0) {
    const code = declRewrites.size === 0
      ? ast.lines.join("\n")
      : ast.lines.map((_, i) => sourceLine(i)).join("\n");
    return { code, compoundNodeIds: [] };
  }

  // If ALL top-level subgraphs are collapsed, delegate to existing getRootViewCode
  // (it produces identical output and is already battle-tested)
  if (ast.subgraphs.every(sg => collapsedSubgraphIds.has(sg.id))) {
    const code = getRootViewCode(ast);
    return { code, compoundNodeIds: ast.subgraphs.map(sg => sg.id) };
  }

  const output: string[] = [];
  const compoundNodeIds: string[] = [];

  // Build visibility set: root nodes + collapsed compound IDs + visible nodes inside expanded subgraphs
  const visibleNodes = new Set(ast.rootNodes);
  for (const sg of ast.subgraphs) {
    if (collapsedSubgraphIds.has(sg.id)) {
      visibleNodes.add(sg.id); // compound node
      compoundNodeIds.push(sg.id);
    } else {
      // Expanded: add nodes, but respect nested collapsed subgraphs
      visibleNodes.add(sg.id); // subgraph ID itself
      addVisibleNodesRecursive(sg, collapsedSubgraphIds, visibleNodes, compoundNodeIds, ast.allSubgraphsFlat);
    }
  }

  // Build lookup: lexically top-level subgraph line ranges (includes groups
  // adopted via membership-by-reference, which stay lexically at root)
  const topSgRanges = getLexicalRootSubgraphs(ast)
    .map(sg => ({
      start: sg.sourceStart,
      end: sg.sourceEnd,
      id: sg.id,
      label: sg.label,
      collapsed: collapsedSubgraphIds.has(sg.id),
      hidden: hasCollapsedAncestor(sg.id, ast, collapsedSubgraphIds),
    }));

  // Edge deduplication for redirected edges
  const emittedRedirectedEdges = new Set<string>();
  const deferredRootEdges: string[] = [];

  for (let i = 0; i < ast.lines.length; i++) {
    const trimmed = ast.lines[i].trim();

    // Drop ALL ~~~ invisible layout links in filtered views.
    // They only make sense in fully-raw rendering (handled by the short-circuit above).
    // In any filtered view, cross-boundary ~~~ links cause phantom node duplicates.
    if (/~{3,}/.test(trimmed)) continue;

    // Check if this line starts a lexically top-level subgraph block
    const sgRange = topSgRanges.find(r => i === r.start);
    if (sgRange) {
      if (sgRange.hidden) {
        // Hidden: an ancestor is collapsed, so this adopted block lives
        // inside that compound — skip it, redirect its cross-boundary edges.
        emitRedirectedEdgesInRange(
          ast,
          sgRange.start + 1,
          sgRange.end,
          visibleNodes,
          emittedRedirectedEdges,
          output,
          (nodeId) => findCollapsedVisibleOwner(nodeId, ast, collapsedSubgraphIds) || nodeId
        );
        i = sgRange.end;
      } else if (sgRange.collapsed) {
        // Collapsed → emit compound node, skip to end
        const safeLabel = sgRange.label.replace(/"/g, "'");
        output.push(`    ${sgRange.id}["\uD83D\uDCC2 ${safeLabel}"]`);
        emitRedirectedEdgesInRange(
          ast,
          sgRange.start + 1,
          sgRange.end,
          visibleNodes,
          emittedRedirectedEdges,
          output,
          (nodeId) => findCollapsedVisibleOwner(nodeId, ast, collapsedSubgraphIds) || nodeId
        );
        i = sgRange.end;
      } else {
        // Expanded → pass through the subgraph line (rewriting title-only
        // declarations whose synthetic ID is edge-referenced)
        output.push(sourceLine(i));
      }
      continue;
    }

    // If inside an EXPANDED subgraph, check for nested collapsed children
    // (but skip if inside a COLLAPSED subgraph — it was already handled)
    const containingSg = topSgRanges.find(r => i > r.start && i <= r.end);
    if (containingSg) {
      if (containingSg.collapsed) {
        continue; // already emitted as compound node
      }
      // Inside expanded subgraph — check if this line starts a nested subgraph
      // that should be collapsed
      const nestedSg = ast.allSubgraphsFlat.get(
        [...ast.allSubgraphsFlat.values()].find(
          sg => sg.sourceStart === i && collapsedSubgraphIds.has(sg.id)
        )?.id || ''
      );
      if (nestedSg && collapsedSubgraphIds.has(nestedSg.id)) {
        // Nested subgraph is collapsed — emit compound node and skip to end
        const safeLabel = nestedSg.label.replace(/"/g, "'");
        output.push(`    ${nestedSg.id}["\uD83D\uDCC2 ${safeLabel}"]`);
        emitRedirectedEdgesInRange(
          ast,
          nestedSg.sourceStart + 1,
          nestedSg.sourceEnd,
          visibleNodes,
          emittedRedirectedEdges,
          output,
          (nodeId) => findCollapsedVisibleOwner(nodeId, ast, collapsedSubgraphIds) || nodeId
        );
        i = nestedSg.sourceEnd;
        continue;
      }
      // Check if we're inside a nested collapsed subgraph (deeper than start line)
      // i.e., this line is between a collapsed nested subgraph's start+1 and end
      let insideCollapsedNested = false;
      for (const sg of ast.allSubgraphsFlat.values()) {
        if (sg.id === containingSg.id) continue; // skip the parent
        if (collapsedSubgraphIds.has(sg.id) &&
            i > sg.sourceStart && i <= sg.sourceEnd) {
          insideCollapsedNested = true;
          break;
        }
      }
      if (insideCollapsedNested) {
        continue; // skip — inside a collapsed nested subgraph
      }

      const endingExpandedSubgraph = [...ast.allSubgraphsFlat.values()].find(
        sg => sg.sourceEnd === i && !collapsedSubgraphIds.has(sg.id)
      );
      if (endingExpandedSubgraph) {
        emitDirectNodeDefinitionsIfMissing(output, ast, endingExpandedSubgraph);
        output.push(ast.lines[i]);
        continue;
      }

      // Edges inside expanded parents can still point into collapsed nested
      // children. Redirect them here so hidden child nodes do not reappear as
      // Mermaid-created phantom nodes.
      const chainEdges = parseAllEdges(trimmed);
      if (chainEdges.length > 0) {
        const allVisibleAndInternal = chainEdges.every(edge =>
          visibleNodes.has(edge.from) &&
          visibleNodes.has(edge.to) &&
          isNodeWithinSubgraph(edge.from, containingSg.id, ast) &&
          isNodeWithinSubgraph(edge.to, containingSg.id, ast)
        );

        if (allVisibleAndInternal) {
          output.push(ast.lines[i]);
          continue;
        }

        for (const edgeParsed of chainEdges) {
          let fromId = edgeParsed.from;
          let toId = edgeParsed.to;

          if (!visibleNodes.has(fromId)) {
            fromId = findCollapsedVisibleOwner(fromId, ast, collapsedSubgraphIds) || fromId;
          }
          if (!visibleNodes.has(toId)) {
            toId = findCollapsedVisibleOwner(toId, ast, collapsedSubgraphIds) || toId;
          }

          if (fromId === toId) continue;

          const edgeKey = `${fromId}-->${toId}`;
          if (emittedRedirectedEdges.has(edgeKey)) continue;
          emittedRedirectedEdges.add(edgeKey);

          const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
          const edgeLine = `    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`;
          const fromInsideCurrent = isNodeWithinSubgraph(fromId, containingSg.id, ast);
          const toInsideCurrent = isNodeWithinSubgraph(toId, containingSg.id, ast);

          if (fromInsideCurrent && toInsideCurrent) {
            output.push(edgeLine);
          } else {
            if (fromInsideCurrent && fromId === edgeParsed.from) {
              emitNodeDefinitionIfMissing(output, ast, fromId);
            }
            if (toInsideCurrent && toId === edgeParsed.to) {
              emitNodeDefinitionIfMissing(output, ast, toId);
            }
            deferredRootEdges.push(edgeLine);
          }
        }
        continue;
      }

      output.push(sourceLine(i));
      continue;
    }

    // Root-level line processing (same as getRootViewCode but with hybrid visibility)

    // Handle edge lines: check if endpoints need redirecting
    const chainEdges = parseAllEdges(trimmed);
    if (chainEdges.length > 0) {
      // If ALL endpoints are visible, pass through as-is
      const allVisible = chainEdges.every(e =>
        visibleNodes.has(e.from) && visibleNodes.has(e.to)
      );

      if (allVisible) {
        output.push(ast.lines[i]);
      } else {
        // Skip invisible links (~~~)
        if (/~{3,}/.test(ast.lines[i])) { /* skip entire line */ }
        else {
          for (const edgeParsed of chainEdges) {
            let fromId = edgeParsed.from;
            let toId = edgeParsed.to;

            // Only redirect if the endpoint is inside a COLLAPSED group
            if (!visibleNodes.has(fromId)) {
              fromId = findCollapsedVisibleOwner(fromId, ast, collapsedSubgraphIds) || fromId;
            }
            if (!visibleNodes.has(toId)) {
              toId = findCollapsedVisibleOwner(toId, ast, collapsedSubgraphIds) || toId;
            }

            if (fromId === toId) continue;

            const edgeKey = `${fromId}-->${toId}`;
            if (emittedRedirectedEdges.has(edgeKey)) continue;
            emittedRedirectedEdges.add(edgeKey);

            const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
            emitVisibleEndpointDefinitionsForRedirectedEdge(output, ast, edgeParsed, fromId, toId, visibleNodes);
            output.push(`    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`);
          }
        }
      }
      continue;
    }

    // class lines: emit for the subset of referenced nodes that are visible
    if (/^class\s/i.test(trimmed)) {
      const classMatch = trimmed.match(/^class\s+(.+?)\s+(\S+)$/i);
      if (classMatch) {
        const visibleIds = classMatch[1].split(',').map(s => s.trim())
          .filter(id => visibleNodes.has(id));
        if (visibleIds.length > 0) {
          output.push(`    class ${visibleIds.join(',')} ${classMatch[2]}`);
        }
      }
      continue;
    }

    // style lines: only emit if the referenced node is visible
    if (/^style\s/i.test(trimmed)) {
      const styleMatch = trimmed.match(/^style\s+(\S+)/i);
      if (styleMatch && visibleNodes.has(styleMatch[1])) {
        output.push(ast.lines[i]);
      }
      continue;
    }

    // Everything else — pass through unchanged
    output.push(ast.lines[i]);
  }

  output.push(...deferredRootEdges);

  return { code: output.join("\n"), compoundNodeIds };
}

/**
 * Generate Mermaid code for a SPECIFIC SCOPE view.
 * Includes direct nodes, child subgraphs (collapsed or expanded), and boundary stubs.
 * ONLY emits edges where both endpoints are valid in this scope view.
 *
 * @param collapsedSubgraphIds — optional set of subgraph IDs to collapse.
 *   Child subgraphs in this set → compound nodes. Others → original subgraph block.
 *   When omitted, ALL child subgraphs are collapsed (backward-compatible default).
 */
export function getScopeViewCode(
  ast: MermaidAST,
  scopeId: string,
  collapsedSubgraphIds?: Set<string>
): {
  code: string;
  boundaryNodeIds: string[];
} {
  const sg = ast.allSubgraphsFlat.get(scopeId);
  if (!sg) return { code: ast.headerLine + "\n    A[Scope not found]", boundaryNodeIds: [] };

  const output: string[] = [ast.headerLine];
  const boundaryNodeIds: string[] = [];

  // Determine which children are collapsed
  // Default: all children collapsed (backward compatible)
  const isChildCollapsed = (childId: string) =>
    !collapsedSubgraphIds || collapsedSubgraphIds.has(childId);

  const declRewrites = buildDeclarationRewrites(ast);
  const sourceLine = (i: number) => declRewrites.get(i) ?? ast.lines[i];

  // Build the set of node IDs visible in this scope
  const visibleNodes = new Set(sg.directNodes);
  for (const child of sg.children) {
    visibleNodes.add(child.id);
    // If child is expanded, add its internal nodes — stopping at collapsed
    // descendants when an explicit collapse state is provided
    if (!isChildCollapsed(child.id)) {
      if (collapsedSubgraphIds) {
        addVisibleNodesRecursive(child, collapsedSubgraphIds, visibleNodes, [], ast.allSubgraphsFlat);
      } else {
        for (const nid of getAllNodesInSubgraph(child, ast.allSubgraphsFlat)) {
          visibleNodes.add(nid);
        }
      }
    }
  }

  // Visible stand-in for a hidden node in this scope: the outermost collapsed
  // subgraph on its ownership chain below the scope. With no explicit
  // collapse state (default: all children collapsed), that is the direct child.
  const findScopeStandIn = (nodeId: string): string | null => {
    const direct = findChildContaining(nodeId, sg, ast.allSubgraphsFlat);
    if (!direct || !collapsedSubgraphIds) return direct;
    let currentId = ast.allSubgraphsFlat.has(nodeId)
      ? ast.allSubgraphsFlat.get(nodeId)!.parentId
      : findOwnerSubgraph(nodeId, ast);
    let outermost: string | null = null;
    while (currentId && currentId !== scopeId) {
      if (collapsedSubgraphIds.has(currentId)) outermost = currentId;
      currentId = ast.allSubgraphsFlat.get(currentId)?.parentId ?? null;
    }
    return outermost ?? direct;
  };

  // Emit lines from the subgraph body (between sourceStart+1 and sourceEnd-1)
  // but skip nested subgraph internals and cross-scope edge lines
  const innerStart = sg.sourceStart + 1;
  const innerEnd = sg.sourceEnd;
  const childRanges = sg.children.map(c => ({
    start: c.sourceStart, end: c.sourceEnd, id: c.id, label: c.label,
    collapsed: isChildCollapsed(c.id),
  }));
  const scopeRedirectedEdges = new Set<string>();
  const deferredScopeEdges: string[] = [];

  for (let i = innerStart; i < innerEnd; i++) {
    const trimmed = ast.lines[i].trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    if (/^direction\s/i.test(trimmed)) continue;
    if (/^classDef\s/i.test(trimmed) || /^class\s/i.test(trimmed) || /^style\s/i.test(trimmed)) continue;
    if (/^click\s/i.test(trimmed) || /^linkStyle\s/i.test(trimmed)) continue;

    // Membership-by-reference lines naming a child group are structural —
    // the child is emitted as a compound or block elsewhere.
    const bareGroupRef = trimmed.match(/^([A-Za-z_]\w*)$/);
    if (bareGroupRef && sg.children.some(c => c.id === bareGroupRef[1])) continue;

    // Check if this line is inside a child subgraph's body
    const childRange = childRanges.find(cr => i >= cr.start && i <= cr.end);
    if (childRange) {
      if (childRange.collapsed) {
        // Collapsed child: emit compound node on the start line, skip internals
        if (i === childRange.start) {
          const safeLabel = childRange.label.replace(/"/g, "'");
          output.push(`    ${childRange.id}["\uD83D\uDCC2 ${safeLabel}"]`);
          emitRedirectedEdgesInRange(
            ast,
            childRange.start + 1,
            childRange.end,
            visibleNodes,
            scopeRedirectedEdges,
            output,
            (nodeId) => findScopeStandIn(nodeId) || nodeId
          );
        }
      } else {
        // Expanded child: honor collapse state of nested descendants
        if (collapsedSubgraphIds && i > childRange.start) {
          const nestedCollapsed = [...ast.allSubgraphsFlat.values()].find(
            s => s.sourceStart === i && s.id !== childRange.id && collapsedSubgraphIds.has(s.id)
          );
          if (nestedCollapsed) {
            const safeLabel = nestedCollapsed.label.replace(/"/g, "'");
            output.push(`    ${nestedCollapsed.id}["📂 ${safeLabel}"]`);
            emitRedirectedEdgesInRange(
              ast,
              nestedCollapsed.sourceStart + 1,
              nestedCollapsed.sourceEnd,
              visibleNodes,
              scopeRedirectedEdges,
              output,
              (nodeId) => findScopeStandIn(nodeId) || nodeId
            );
            i = nestedCollapsed.sourceEnd;
            continue;
          }
          // Redirect edges that point into nested collapsed descendants so
          // hidden nodes do not reappear as Mermaid-created phantoms
          const innerEdges = parseAllEdges(trimmed);
          if (innerEdges.length > 0 &&
              !innerEdges.every(e => visibleNodes.has(e.from) && visibleNodes.has(e.to))) {
            for (const edgeParsed of innerEdges) {
              const fromId = visibleNodes.has(edgeParsed.from)
                ? edgeParsed.from
                : (findScopeStandIn(edgeParsed.from) || edgeParsed.from);
              const toId = visibleNodes.has(edgeParsed.to)
                ? edgeParsed.to
                : (findScopeStandIn(edgeParsed.to) || edgeParsed.to);
              if (fromId === toId) continue;
              if (!visibleNodes.has(fromId) || !visibleNodes.has(toId)) continue; // boundary refs handle these
              const edgeKey = `${fromId}-->${toId}`;
              if (scopeRedirectedEdges.has(edgeKey)) continue;
              scopeRedirectedEdges.add(edgeKey);
              const labelPart = edgeParsed.label ? `|${edgeParsed.label}|` : '';
              const edgeLine = `    ${fromId} ${edgeParsed.arrow}${labelPart} ${toId}`;
              if (isNodeWithinSubgraph(fromId, childRange.id, ast) &&
                  isNodeWithinSubgraph(toId, childRange.id, ast)) {
                output.push(edgeLine);
              } else {
                deferredScopeEdges.push(edgeLine);
              }
            }
            continue;
          }
        }
        if (i === childRange.end) {
          const child = ast.allSubgraphsFlat.get(childRange.id);
          if (child) {
            emitDirectNodeDefinitionsIfMissing(output, ast, child);
          }
        }
        output.push(sourceLine(i));
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
            const childOwner = findScopeStandIn(edgeParsed.from);
            if (childOwner) { fromId = childOwner; hasRedirect = true; }
          }
          if (!toVis) {
            const childOwner = findScopeStandIn(edgeParsed.to);
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

    output.push(sourceLine(i));
  }

  output.push(...deferredScopeEdges);

  // Children adopted via membership-by-reference have their blocks outside
  // this scope's line range — emit them here.
  for (const child of sg.children) {
    const inRange = child.sourceStart > sg.sourceStart && child.sourceEnd < sg.sourceEnd;
    if (inRange || child.sourceEnd < 0) continue;
    if (isChildCollapsed(child.id)) {
      const safeLabel = child.label.replace(/"/g, "'");
      output.push(`    ${child.id}["📂 ${safeLabel}"]`);
      emitRedirectedEdgesInRange(
        ast,
        child.sourceStart + 1,
        child.sourceEnd,
        visibleNodes,
        scopeRedirectedEdges,
        output,
        (nodeId) => findScopeStandIn(nodeId) || nodeId
      );
    } else {
      for (let line = child.sourceStart; line <= child.sourceEnd; line++) {
        output.push(sourceLine(line));
      }
      emitDirectNodeDefinitionsIfMissing(output, ast, child);
    }
  }

  // Some user-authored Mermaid defines a node only as the visible endpoint of
  // a cross-boundary edge, e.g. `External --> Local[Label]` inside the current
  // subgraph. If that edge is converted to a boundary stub, emit the local
  // node definition separately so the scoped view does not point at a phantom.
  emitDirectNodeDefinitionsIfMissing(output, ast, sg);

  // Find internal edges defined outside the subgraph block and emit them
  for (const edge of ast.edges) {
    if (edge.lineIndex >= innerStart && edge.lineIndex < innerEnd) {
      continue;
    }

    let fromId = edge.from;
    let toId = edge.to;
    const fromVis = visibleNodes.has(fromId);
    const toVis = visibleNodes.has(toId);

    if (fromVis && toVis) {
      const labelPart = edge.label ? `|${edge.label}|` : '';
      const edgeKey = `${fromId}-->${toId}`;
      if (!scopeRedirectedEdges.has(edgeKey)) {
        scopeRedirectedEdges.add(edgeKey);
        output.push(`    ${fromId} ${edge.arrow}${labelPart} ${toId}`);
      }
      continue;
    }

    let hasRedirect = false;
    if (!fromVis) {
      const childOwner = findScopeStandIn(fromId);
      if (childOwner) {
        fromId = childOwner;
        hasRedirect = true;
      }
    }
    if (!toVis) {
      const childOwner = findScopeStandIn(toId);
      if (childOwner) {
        toId = childOwner;
        hasRedirect = true;
      }
    }

    if (hasRedirect && fromId !== toId) {
      const fromVisNow = visibleNodes.has(fromId);
      const toVisNow = visibleNodes.has(toId);

      if (fromVisNow && toVisNow) {
        if (!/~{3,}/.test(edge.rawLine)) {
          const edgeKey = `${fromId}-->${toId}`;
          if (!scopeRedirectedEdges.has(edgeKey)) {
            scopeRedirectedEdges.add(edgeKey);
            const labelPart = edge.label ? `|${edge.label}|` : '';
            output.push(`    ${fromId} ${edge.arrow}${labelPart} ${toId}`);
          }
        }
      }
    }
  }

  // Add boundary reference stubs for cross-scope edges
  const boundaryRefs = getBoundaryRefs(ast, scopeId);
  const addedExternalNodes = new Set<string>();

  for (const ref of boundaryRefs) {
    // Skip refs where the inside endpoint is the scope itself
    // (e.g., `A --> B` where B is the current scope — this is the container, not an inner node)
    if (ref.insideNodeId === scopeId) continue;

    let insideVisibleId = ref.insideNodeId;
    if (!visibleNodes.has(insideVisibleId)) {
      const childOwner = findScopeStandIn(insideVisibleId);
      if (!childOwner || !visibleNodes.has(childOwner)) continue;
      insideVisibleId = childOwner;
    }

    const externalVisibleId = resolveVisibleBoundaryExternalId(
      ref.externalNodeId,
      ast,
      scopeId,
      collapsedSubgraphIds
    );
    const extId = `_ext_${externalVisibleId}`;

    if (!addedExternalNodes.has(externalVisibleId)) {
      addedExternalNodes.add(externalVisibleId);
      // Emit stub node preserving original shape (CSS handles the washed-out styling)
      // Any external group renders as a folder stub — collapsed or expanded —
      // so its display label and folder icon come from the AST, never from
      // node-shape scraping (which leaks synthetic IDs for title-only groups).
      const externalSubgraph = ast.allSubgraphsFlat.get(externalVisibleId);
      const safeLabel = (externalSubgraph
        ? `📂 ${normalizeMermaidDisplayLabel(externalSubgraph.label)}`
        : findNodeLabel(ast, externalVisibleId)
      ).replace(/"/g, "'");
      const shape = externalSubgraph
        ? { open: '["', close: '"]' }
        : findNodeShapeBrackets(ast, externalVisibleId);
      output.push(`    ${extId}${shape.open}${safeLabel}${shape.close}`);
      boundaryNodeIds.push(extId);
    }

    // Emit the boundary edge (dotted)
    const edgeKey = ref.direction === "incoming"
      ? `${extId}-.->${insideVisibleId}`
      : `${insideVisibleId}-.->${extId}`;
    if (scopeRedirectedEdges.has(edgeKey)) continue;
    scopeRedirectedEdges.add(edgeKey);

    if (ref.direction === "incoming") {
      output.push(`    ${extId} -.-> ${insideVisibleId}`);
    } else {
      output.push(`    ${insideVisibleId} -.-> ${extId}`);
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
    // Emit for the subset of referenced nodes that are visible in this scope
    if (/^class\s/i.test(trimmed)) {
      const classMatch = trimmed.match(/^class\s+(.+?)\s+(\S+)$/i);
      if (classMatch) {
        const visibleIds = classMatch[1].split(',').map(s => s.trim())
          .filter(id => visibleNodes.has(id));
        if (visibleIds.length > 0) {
          output.push(`    class ${visibleIds.join(',')} ${classMatch[2]}`);
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

  // Include edges that are fully internal to this scope. The scope's own ID
  // counts as inside — edges may reference the container itself.
  const allInsideNodes = getAllNodesInSubgraph(sg, ast.allSubgraphsFlat);
  allInsideNodes.add(sg.id);
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

/**
 * Recursively add visible nodes from a subgraph, stopping at collapsed children.
 * Collapsed children become compound node IDs; expanded children recurse.
 */
function addVisibleNodesRecursive(
  sg: SubgraphNode,
  collapsedSubgraphIds: Set<string>,
  visibleNodes: Set<string>,
  compoundNodeIds: string[],
  allFlat: Map<string, SubgraphNode>
): void {
  // Add direct nodes of this subgraph
  for (const nid of sg.directNodes) {
    visibleNodes.add(nid);
  }
  // Process children
  for (const child of sg.children) {
    if (collapsedSubgraphIds.has(child.id)) {
      // Collapsed child → compound node
      visibleNodes.add(child.id);
      compoundNodeIds.push(child.id);
    } else {
      // Expanded child → recurse
      visibleNodes.add(child.id);
      addVisibleNodesRecursive(child, collapsedSubgraphIds, visibleNodes, compoundNodeIds, allFlat);
    }
  }
}


/** Subgraph blocks that start at the top lexical level of the source (not
 * inside another block). Usually identical to ast.subgraphs, but a group
 * adopted via membership-by-reference stays lexically top-level while being
 * an AST child of its adopter. */
function getLexicalRootSubgraphs(ast: MermaidAST): SubgraphNode[] {
  const all = [...ast.allSubgraphsFlat.values()];
  return all.filter(sg =>
    sg.sourceEnd >= 0 &&
    !all.some(other =>
      other !== sg && sg.sourceStart > other.sourceStart && sg.sourceEnd < other.sourceEnd
    )
  );
}

/** Title-only groups get parser-minted synthetic IDs (e.g. `Launch_Strategy`
 * for `subgraph Launch Strategy`) that stock Mermaid does not know. When such
 * an ID is referenced by an edge, passthrough views must rewrite the
 * declaration to explicit-ID form (`subgraph Launch_Strategy["Launch
 * Strategy"]`) so the edge binds to the cluster instead of minting a phantom
 * node. Returns a map of sourceStart line index → rewritten declaration. */
function buildDeclarationRewrites(ast: MermaidAST): Map<number, string> {
  const rewrites = new Map<number, string>();
  for (const edge of ast.edges) {
    for (const id of [edge.from, edge.to]) {
      const sg = ast.allSubgraphsFlat.get(id);
      if (!sg?.titleOnly || sg.sourceStart < 0 || rewrites.has(sg.sourceStart)) continue;
      const indent = ast.lines[sg.sourceStart].match(/^\s*/)?.[0] ?? '';
      rewrites.set(sg.sourceStart, `${indent}subgraph ${sg.id}["${sg.label.replace(/"/g, "'")}"]`);
    }
  }
  return rewrites;
}

/** True when some AST ancestor of the subgraph is collapsed (the subgraph is
 * hidden inside an ancestor's compound node). */
function hasCollapsedAncestor(
  sgId: string,
  ast: MermaidAST,
  collapsedSubgraphIds: Set<string>
): boolean {
  let current = ast.allSubgraphsFlat.get(sgId)?.parentId ?? null;
  while (current) {
    if (collapsedSubgraphIds.has(current)) return true;
    current = ast.allSubgraphsFlat.get(current)?.parentId ?? null;
  }
  return false;
}

/** Check if a line index falls inside any subgraph. */
function isLineInsideSubgraph(lineIdx: number, ast: MermaidAST): boolean {
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (lineIdx > sg.sourceStart && lineIdx < sg.sourceEnd) return true;
  }
  return false;
}

/** Find which subgraph (if any) directly contains a given node ID.
 * Edge endpoints may themselves be subgraph IDs (groups inside a group);
 * those are owned by their parent subgraph, not tracked in directNodes. */
function findOwnerSubgraph(nodeId: string, ast: MermaidAST): string | null {
  const asSubgraph = ast.allSubgraphsFlat.get(nodeId);
  if (asSubgraph) return asSubgraph.parentId;
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (sg.directNodes.includes(nodeId)) return sg.id;
  }
  return null;
}

/** Find the visible collapsed ancestor that should stand in for a hidden node.
 * When nested groups are collapsed along with an ancestor, only the OUTERMOST
 * collapsed ancestor is actually visible, so keep walking to the top. */
function findCollapsedVisibleOwner(
  nodeId: string,
  ast: MermaidAST,
  collapsedSubgraphIds: Set<string>
): string | null {
  let currentId = findOwnerSubgraph(nodeId, ast);
  let outermostCollapsed: string | null = null;

  while (currentId) {
    if (collapsedSubgraphIds.has(currentId)) outermostCollapsed = currentId;
    currentId = ast.allSubgraphsFlat.get(currentId)?.parentId ?? null;
  }

  return outermostCollapsed;
}

function resolveVisibleBoundaryExternalId(
  nodeId: string,
  ast: MermaidAST,
  scopeId: string,
  collapsedSubgraphIds?: Set<string>
): string {
  if (!collapsedSubgraphIds) return nodeId;

  const collapsedOwner = findCollapsedVisibleOwner(nodeId, ast, collapsedSubgraphIds);
  // A collapsed group is its own stand-in only when no collapsed ancestor
  // hides it; otherwise the outermost collapsed ancestor is the visible one.
  if (
    ast.allSubgraphsFlat.has(nodeId) &&
    collapsedSubgraphIds.has(nodeId) &&
    !collapsedOwner
  ) {
    return nodeId;
  }
  if (!collapsedOwner || isAncestorSubgraph(collapsedOwner, scopeId, ast)) return nodeId;
  return collapsedOwner;
}

function isAncestorSubgraph(candidateId: string, scopeId: string, ast: MermaidAST): boolean {
  let current = ast.allSubgraphsFlat.get(scopeId)?.parentId ?? null;
  while (current) {
    if (current === candidateId) return true;
    current = ast.allSubgraphsFlat.get(current)?.parentId ?? null;
  }
  return false;
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
  // A subgraph ID's scope is its parent group (null = top-level) — group
  // boundary stubs navigate to where the group is visible, not to root.
  const asSubgraph = ast.allSubgraphsFlat.get(nodeId);
  if (asSubgraph) return asSubgraph.parentId;
  for (const sg of ast.allSubgraphsFlat.values()) {
    if (sg.directNodes.includes(nodeId)) return sg.id;
  }
  return null;
}
