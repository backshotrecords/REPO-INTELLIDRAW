# Audit report: mermaidParser.ts — subgraph-ID / deep-nesting bug class

> Generated 2026-07-06. Report only — no fixes applied. All line numbers refer to
> `src/utils/mermaidParser.ts` unless noted. Findings marked CONFIRMED were
> empirically reproduced by running the real parser via `npx tsx`; SUSPECTED
> findings were traced by reading only.
>
> Context: two instances of this bug class were fixed on 2026-07-06 (branch
> `codex/getting-ready-to-charge-money`): (1) `findOwnerSubgraph()` now returns
> `parentId` when the queried ID is itself a subgraph; (2)
> `findCollapsedVisibleOwner()` now returns the OUTERMOST collapsed ancestor.
> This report covers everything that remains.

## Resolution status (2026-07-07)

All 11 findings are FIXED on this branch, each with a regression test in
`src/utils/mermaidParser.test.ts` (F10 in `src/utils/mermaidDom.test.ts`):

- **F1** — pass-1 no longer records subgraph IDs as member nodes (guard in
  `recordNodeReference`/`recordNodeMembership` + post-pass cleanup for forward
  references).
- **F2** — `emitNodeDefinitionIfMissing` refuses IDs in `allSubgraphsFlat`.
- **F3** — `getScopeViewCode` honors collapse state at any depth (recursive
  visibility, nested compound emission, edge redirect to the outermost
  collapsed stand-in below the scope).
- **F4** — `resolveVisibleBoundaryExternalId` early return only applies when
  the collapsed group has no collapsed ancestor.
- **F5** — `findNodeScope` returns `parentId` for subgraph IDs.
- **F6** — boundary stubs for ANY external group (collapsed or expanded) use
  `📂 <display label>` from the AST.
- **F7** — `extractScopeCode` treats the scope's own ID as inside, so
  container-referencing edges survive export. (The scope-VIEW skip at the
  `insideNodeId === scopeId` check is kept as deliberate design — no inner
  node exists to anchor a stub to.)
- **F8** — bare membership lines naming a group adopt it as a child
  (membership-by-reference, forward-reference aware, cycle-guarded); all three
  view generators handle adopted blocks via lexical-root walking.
- **F9** — `class` lines emit their visible subset instead of all-or-nothing
  (all three views).
- **F10** — verified real, fixed: exact label matches now win before fuzzy
  containment in `mermaidDom.ts`.
- **F11** — title-only declarations whose synthetic ID is edge-referenced are
  rewritten to explicit-ID form (`subgraph Launch_Strategy["Launch Strategy"]`)
  in every view including the raw all-expanded short-circuit.

## Finding 1 — Pass-1 records subgraph IDs into `directNodes` when used as edge endpoints inside another group

- **Severity**: high
- **Location**: `recordNodeReference` / `recordNodeMembership` (lines 195–268); root cause aggravated by `isInsideChildSubgraph` (419–429) because `getAllNodesInSubgraph(child)` does not contain `child.id` itself.
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph S1[Group One]
    A[Node A]
    A --> GroupB
  end
  subgraph GroupB[Group B]
    B1[Node B1]
  end
  ```
  Neither `recordNodeReference` nor `recordNodeMembership` checks `allSubgraphsFlat.has(nodeId)` (and for forward references the subgraph doesn't exist yet, so no point-of-declaration cleanup exists either). Result: `S1.directNodes = ['A', 'GroupB']` — a **sibling top-level group** becomes a "plain node member" of S1. Order-independent: the same happens if `GroupB` is declared before the edge. Even a **direct child** group ID gets polluted (`Top.directNodes = ['Mid', 'T1x']` in the T15c fixture) because `isInsideChildSubgraph` never treats the child's own ID as inside it (benign for direct children, harmful for non-descendants).
- **Expected vs actual** (all CONFIRMED):
  1. `getBoundaryRefs(ast,'S1')` — expected an outgoing ref to `GroupB`; **actual `[]`** (edge classified as internal).
  2. `getScopeViewCode(ast,'S1')` — expected `A -.-> _ext_GroupB` boundary stub; **actual**: `A --> GroupB` kept + `emitDirectNodeDefinitionsIfMissing` emits `GroupB[Group B]` → a solid phantom plain node impersonating the sibling group inside S1's canvas (no 📂, not navigable, no dotted styling). For title-only groups the phantom is `GroupB["GroupB"]`.
  3. `getRootViewWithCollapseState` with S1 expanded (any non-empty collapse set): the `endingExpandedSubgraph` branch (1047–1054) emits `GroupB[Group B]` **inside S1's `subgraph … end` block**. With GroupB collapsed, output contains both that def (inside S1) and the compound `GroupB["📂 Group B"]` at root — in Mermaid, first membership wins, so the GroupB compound is rendered captured **inside S1**. With GroupB expanded, output declares node `GroupB` inside S1 *and* `subgraph GroupB` — node/cluster ID collision.
  4. `findNodeScope(ast,'GroupB')` returns `'S1'` (wrong; feeds Finding 5's navigation).
- **Status**: CONFIRMED (all four outputs reproduced). i tested and its all true they need to be fixed

## Finding 2 — `emitNodeDefinitionIfMissing` / `emitVisibleEndpointDefinitionsForRedirectedEdge` emit plain node definitions for subgraph-ID endpoints

- **Severity**: high (when the subgraph is expanded), low (when collapsed)
- **Location**: lines 710–754 (`hasNodeDefinition`'s regex `(?:^|\s|>)\s*ID\s*[\[({<"]` matches `subgraph T2[Second]` lines; no `allSubgraphsFlat` check before emitting); triggered from `getRootViewCode` line 874 and `getRootViewWithCollapseState` lines 1099–1102/1149.
- **Scenario** (independent of Finding 1 — the edge is at root level):
  ```mermaid
  flowchart TD
  subgraph T1[First]
    A[Node A]
  end
  A --> T2
  subgraph T2[Second]
    B[Node B]
  end
  ```
  Root view with T1 collapsed, T2 **expanded**: redirecting `A --> T2` to `T1 --> T2` calls `emitNodeDefinitionIfMissing(output, ast, 'T2')`; T2's block hasn't been walked yet, so `hasNodeDefinition(output)` is false and `hasNodeDefinition(ast.lines)` accidentally matches the `subgraph T2[Second]` declaration.
- **Expected**: `T1["📂 First"]` / `T1 --> T2` / `subgraph T2 … end` only. **Actual**:
  ```
      T1["📂 First"]
      T2[Second]        <-- plain NODE definition for an expanded GROUP
      T1 --> T2
  subgraph T2[Second]
    B[Node B]
  end
  ```
  Node and cluster share the ID `T2` — broken/ambiguous Mermaid rendering. In the all-collapsed variant the same path emits a duplicate `T2[Second]` before the compound `T2["📂 Second"]` (last label wins, so mostly cosmetic there).
- **Status**: CONFIRMED (generated code); the exact Mermaid render artifact from the node/cluster ID collision is SUSPECTED (not rendered in this audit). i looked at this, and every way i turned it i got the expected visual result... not understanding the problem please dumb it down for me more so i can understand the issue fully

## Finding 3 — `getScopeViewCode` ignores collapse state for anything deeper than direct children

- **Severity**: medium-high (UI collapse toggle is a silent no-op; hidden-by-user content stays visible)
- **Location**: lines 1231–1273 — `childRanges` is built from `sg.children` only, and the expanded-child branch pushes every line in the child's range unchanged; `visibleNodes` (1217–1225) likewise adds *all* descendants of an expanded child regardless of `collapsedSubgraphIds`.
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph Top[Top]
    subgraph Child[Child]
      C1[C One]
      subgraph Grand[Grand]
        G1[G One]
        G2[G Two]
      end
      C1 --> G1
    end
    T1[T One]
    T1 --> C1
  end
  ```
  `getScopeViewCode(ast, 'Top', new Set(['Grand']))` — user opened Top, Child expanded, and collapsed Grand (the overlay in `SubgraphCollapseOverlay.tsx` happily offers this toggle for any rendered cluster, and `WorkspacePage.tsx:2578` adds it to the set).
- **Expected**: `Grand["📂 Grand"]` compound inside Child, `C1 --> Grand`. **Actual**: full `subgraph Grand … end` block with G1/G2 rendered expanded — the collapse state is ignored. Contrast: `getRootViewWithCollapseState` handles nested collapsed groups at arbitrary depth correctly (verified, see CLEAN list), so the same set produces different results at root vs in a scope.
- **Status**: CONFIRMED. what i see in the scenario is grand does get the collapse button infact i cant even click it.

## Finding 4 — `resolveVisibleBoundaryExternalId` early-return bypasses the outermost-collapsed-ancestor logic for subgraph-ID endpoints (fix #2 incomplete)

- **Severity**: medium (wrong/duplicate boundary stubs; stub points at a group that is invisible in every view)
- **Location**: line 1596: `if (ast.allSubgraphsFlat.has(nodeId) && collapsedSubgraphIds.has(nodeId)) return nodeId;`
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph Alpha[Alpha]
    subgraph AMid[A Mid]
      subgraph ADeep[A Deep]
        AD1[AD One]
      end
    end
  end
  subgraph Beta[Beta]
    B1[B One]
  end
  ADeep --> B1
  B1 --> AD1
  ```
  `getScopeViewCode(ast, 'Beta', new Set(['AMid','ADeep']))`. Both edges touch the same hidden region (ADeep is inside collapsed AMid, so only AMid is visible anywhere).
- **Expected**: both boundary stubs resolve to the outermost collapsed visible stand-in → one `_ext_AMid`. **Actual**:
  ```
      _ext_ADeep["📂 A Deep"]
      _ext_ADeep -.-> B1
      _ext_AMid["📂 A Mid"]
      B1 -.-> _ext_AMid
  ```
  The plain-node endpoint (`AD1`) goes through `findCollapsedVisibleOwner` and correctly yields `AMid`; the subgraph-ID endpoint (`ADeep`) hits the early return and yields itself — the exact innermost-vs-outermost mistake fix #2 addressed, surviving on the subgraph-ID path.
- **Status**: CONFIRMED. yeah i see it.

## Finding 5 — `findNodeScope` still uses the old directNodes-only pattern; boundary-click navigation breaks for group stubs

- **Severity**: medium (wrong navigation: jumps to root, or into an unrelated scope when combined with Finding 1)
- **Location**: `findNodeScope` lines 1630–1635; sole caller `src/pages/WorkspacePage.tsx:1328` (`handleBoundaryNodeClick`).
- **Scenario**: In any scope view where a boundary stub stands for a group — which is routine: collapsed sibling groups produce `_ext_GroupId` stubs (e.g. `_ext_Launch_Strategy`, `_ext_AMid` above). Clicking the stub strips `_ext_` and calls `findNodeScope(parsedAST, 'AMid')`.
- **Expected**: navigate to the group's parent scope (`Alpha`) — i.e., the fix #1 pattern (`return parentId when the ID is a subgraph`) applied here. **Actual**: `findNodeScope('AMid') === null` (subgraph IDs are in no directNodes list) → `handleScopeNavigate(null)` → jumps to ROOT, where a deeply nested group isn't even visible. Empirically: `findNodeScope(Inner)=null`, `findNodeScope(Mid)=null` for a 3-level fixture. Worse, with Finding 1's pollution `findNodeScope('GroupB')='S1'` → navigates into a scope that merely *references* the group.
- **Status**: CONFIRMED (function outputs reproduced; caller behavior traced by reading).

## Finding 6 — Boundary stubs for non-collapsed external subgraphs get raw-ID labels / wrong shape, no 📂

- **Severity**: medium (wrong labels)
- **Location**: lines 1416–1425 (`isCollapsedExternalSubgraph` is false when `collapsedSubgraphIds` is `undefined` or doesn't contain the group) + `findNodeLabel` (543) which only matches node-shape brackets.
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph S1[Group One]
    A[Node A]
  end
  subgraph Launch Strategy
    L1[Launch Node]
  end
  Launch_Strategy --> A
  ```
  `getScopeViewCode(ast, 'S1', new Set())` (external group expanded), or the no-arg default.
- **Expected**: `_ext_Launch_Strategy["📂 Launch Strategy"]` (or at least the display label). **Actual**: `_ext_Launch_Strategy["Launch_Strategy"]` — the synthetic underscored ID leaks as the user-visible label, no folder icon. For bracket-declared groups (`subgraph X[Nice Label]`) the label comes out right only because `findNodeLabel`'s regex coincidentally matches the `subgraph` line — and `findNodeShapeBrackets` then reports square brackets, so the stub renders as a plain node either way.
- **Status**: CONFIRMED. when you collapse launch strategy it some how becomes connected to group one

## Finding 7 — Edges whose endpoint is the opened scope's own container are silently dropped

- **Severity**: medium (lost relationships; no boundary indication at all)
- **Location**: line 1396 (`if (ref.insideNodeId === scopeId) continue;`); `extractScopeCode` has the sibling issue at line 1502 (`allInsideNodes` never contains `sg.id`, so `A1 --> Top` written outside the block is dropped from exports).
- **Scenario**:
  
  ```mermaid
  flowchart TD
  subgraph S1[Group One]
    A[Node A]
  end
  R[Root] --> S1
  S1 --> R
  ```
  `getScopeViewCode(ast, 'S1', new Set())`.
- **Expected**: some boundary indication (e.g. `_ext_R` stub attached at container level, or at least documented behavior). **Actual**: the opened view is just `A[Node A]` — both container-level edges vanish with no trace. Same applies when the source is a sibling *group* (`S2 --> S1`). Possibly a deliberate design decision (there is no inner node to anchor the stub to), but it is silent information loss and interacts badly with Mermaid's common `GroupA --> GroupB` idiom. For `extractScopeCode('Top')`, `A1 --> Top` is lost from the export while `ChildA --> ChildB` (descendant-group edge) is correctly kept — CONFIRMED.
- **Status**: CONFIRMED. tested and visually its ok but may still need to be fixed to stop the information loss incase that cause some other compound error 

## Finding 8 — Bare-membership line naming a later-declared subgraph produces an inconsistent AST (member node + top-level sibling)

- **Severity**: medium (structure mismatch vs Mermaid; two compounds instead of nesting)
- **Location**: bare-membership handling lines 131–135 → `recordNodeMembership` (no `allSubgraphsFlat`/forward-declaration awareness).
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph S1[One]
    GroupB
  end
  subgraph GroupB[Group B]
    B1[Node B1]
  end
  ```
- **Expected**: Mermaid's membership-by-reference nests GroupB under S1 (or, at minimum, the parser should pick one interpretation consistently). **Actual**: `S1.directNodes = ['GroupB']` *and* `GroupB.parentId = null` — GroupB is simultaneously a plain member of S1 and a top-level sibling. Root view emits two separate compounds `S1["📂 One"]` and `GroupB["📂 Group B"]`; opening S1 emits the phantom `GroupB[Group B]` plain node (Finding 1 mechanics).
- **Status**: CONFIRMED (parser state and generated views); the claim about real Mermaid nesting semantics is SUSPECTED (not rendered against upstream Mermaid). yeah this one visually is crazy when fully minimized it becomes two group nodes side by side instead of one group node containing everything and when all maximized i cant even click group b

## Finding 9 — All-or-nothing `class` filtering drops styling for visible groups in scope views

- **Severity**: low (cosmetic)
- **Location**: lines 1457–1466 (scope view), same pattern at 883–891 / 1157–1166.
- **Scenario**: `class Mid,Top someClass` with source containing `Top > Mid`; `getScopeViewCode(ast,'Top', new Set(['Mid']))`.
- **Expected**: Mid (visible compound) keeps its class. **Actual**: the whole `class` line is dropped because `Top` (the scope container, never in `visibleNodes`) fails the `every` check. Root/collapse-state views handle subgraph-ID `style`/`class` lines correctly (verified).
- **Status**: CONFIRMED.

## Finding 10 — `mermaidDom.ts` label-fallback can map a cluster to the wrong group when labels repeat across nesting levels

- **Severity**: low (theoretical; the ID-candidate path normally wins)
- **Location**: `src/utils/mermaidDom.ts:39–51` — first `allSubgraphsFlat` entry whose label fuzzily matches (`includes` both directions) wins; two nested groups with similar labels ("Auth" inside "Auth Services") would resolve to whichever was declared first, sending collapse toggles to the wrong group.
- **Status**: SUSPECTED (traced only).

## Finding 11 — Synthetic IDs for title-only groups are unknown to stock Mermaid; expanded views render a phantom node instead of binding the edge to the cluster

- **Severity**: high (phantom node + edge detached from the real group, in production)
- **Location**: `parseSubgraphDeclaration` / `labelToSubgraphId` (lines 278–320) mint the synthetic ID, but no emit path rewrites the declaration line; the raw short-circuit (`getRootViewWithCollapseState` line 928–930) and every expanded-block passthrough hand `subgraph Launch Strategy` to Mermaid verbatim.
- **Scenario**:
  ```mermaid
  flowchart TD
  subgraph S1[Group One]
    A[Node A]
  end
  subgraph Launch Strategy
    L1[Launch Node]
  end
  Launch_Strategy --> A
  ```
  Any view in which the title-only group is EXPANDED — including the fully-expanded raw view. The synthetic ID `Launch_Strategy` exists only in the parser's AST; stock Mermaid parses `subgraph Launch Strategy` as a title with no such ID, then sees the edge reference `Launch_Strategy` and mints a brand-new plain node for it.
- **Expected**: edge binds to the Launch Strategy cluster (or its compound). **Actual**: a phantom plain node `Launch_Strategy` renders beside the real group, with the edge attached to the phantom. Views where the group is COLLAPSED look correct, because the parser itself emits the compound node under the synthetic ID — so collapsed and expanded views disagree about the same edge.
- **Suggested fix direction**: when emitting any view (including the raw short-circuit), rewrite title-only declarations whose synthetic ID is referenced by an edge to explicit-ID form: `subgraph Launch_Strategy["Launch Strategy"]`. Renders identically; gives Mermaid the ID binding.
- **Status**: CONFIRMED in the production app (user screenshot, 2026-07-06): phantom `Launch_Strategy` node outside the expanded group, edge into Node A from the phantom.

## Finding 12 — Root-level inline definitions blocked later in-group declarations from claiming the node

- **Severity**: high (node rendered outside its group, duplicated next to the compound)
- **Location**: `recordNodeReference` explicit-owner guard (the `existingExplicitOwner !== currentOwner → return` rule).
- **Scenario**: `B --> M["At-a-Glance Metrics"]` at root, followed later by `subgraph MGroup` containing the declaration `M["At-a-Glance Metrics"]`. The root inline definition claimed explicit ownership (`null`), so the group's declaration was rejected as "stealing". Mermaid itself puts M inside MGroup (subgraph blocks claim members; root mentions don't), so the raw view nested M while collapsed views rendered M at root with a redirected edge into the `📂` compound — both the node and its group visible at once.
- **Fix**: a `null` (root) explicit owner yields to a later in-group declaration, mirroring `recordNodeMembership`'s existing rule for bare membership lines. Group→group stealing remains forbidden (H2 protections unaffected).
- **Status**: CONFIRMED in production (At-a-Glance Metrics dashboard screenshot, 2026-07-07). FIXED 2026-07-07 with regression tests (`root-defined nodes later declared inside a group`).

---

## Verification of the two 2026-07-06 fixes

- **Fix #1 (`findOwnerSubgraph` returns `parentId` for subgraph IDs)**: correct and effective at its callers (`isNodeWithinSubgraph`, `findCollapsedVisibleOwner`, both root-view resolvers). Verified empirically: `Mid --> R` inside collapsed `Top` correctly emits `Top --> R`. However, the same pattern was **not** applied to `findNodeScope` (Finding 5), which is the identical old code shape.
- **Fix #2 (`findCollapsedVisibleOwner` outermost ancestor)**: correct for plain-node endpoints, but **bypassed** when the endpoint is itself a collapsed subgraph ID via `resolveVisibleBoundaryExternalId`'s early return (Finding 4).

## Areas checked and CLEAN (handle subgraph-ID endpoints / deep nesting correctly)

- **Forward references at root level**: `A --> GroupB` before `subgraph GroupB` — GroupB correctly excluded from `rootNodes` and rendered as compound (no phantom).
- **`getRootViewCode` resolver** (`findOwnerSubgraph` + `getTopLevelParent`): nested plain nodes and nested subgraph-ID endpoints both redirect to the correct top-level compound.
- **`getRootViewWithCollapseState` 3-level nesting**: collapsed 3rd-level child inside expanded 1st/2nd levels emits its compound inside the correct block; internal redirected edges are placed inside the right subgraph; cross-boundary edges go to `deferredRootEdges` and endpoint definitions land inside the correct block (verified with `M1 --> R`, `M1 --> I1`, `R --> I2`).
- **Collapsed-mid-level** (`Mid` collapsed inside expanded `Top`, `Inner` not in the set): edges from `Inner`'s contents correctly resolve to `Mid` via the outermost-visible logic.
- **`getBoundaryRefs` inside-side classification**: grandchild subgraph IDs as edge endpoints are recognized as inside (via `getAllNodesInSubgraph` including descendant IDs) and correctly redirected to the visible direct child in scope views.
- **`resolveVisibleBoundaryExternalId`'s `isAncestorSubgraph` guard**: 3-level traces confirm a collapsed *ancestor of the opened scope* does not hijack external endpoints.
- **`getScopePath` / `findNearestAncestor` / `handleEnterScope`**: flat-map based, depth-agnostic; compound-node click → enter scope works for nested IDs.
- **`style`/`class` lines referencing subgraph IDs in root and collapse-state views**: correct keep/drop in all tested combinations (Finding 9 is scope-view-only).
- **`extractScopeCode` descendant-group edges defined outside the block** (`ChildA --> ChildB`): correctly included.
- **`SubgraphCollapseOverlay` / `MermaidRenderer` ID mapping**: primary cluster→scope resolution is ID-based via `allSubgraphsFlat`, depth-agnostic (Finding 10 is only the label fallback).
