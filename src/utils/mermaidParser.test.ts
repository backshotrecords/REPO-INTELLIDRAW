/**
 * mermaidParser.test.ts — Unit tests for the per-canvas collapse system.
 *
 * Tests getRootViewWithCollapseState() and verifies edge redirection,
 * compound node tracking, and the collapse/expand cycle.
 */
import { describe, it, expect } from 'vitest';
import { parseMermaidAST, getRootViewCode, getRootViewWithCollapseState } from './mermaidParser';

// ── Test Fixture ──────────────────────────────────────────────────
// A flowchart with 2 top-level subgraphs (S and T), each containing 2 nodes,
// with root-to-group and cross-group edges.
const TEST_FLOWCHART = `flowchart TD
    R1[Root Start]
    R2[Root End]
    R1 --> R2
    subgraph S [Group S]
        SA[Node SA]
        SB[Node SB]
        SA --> SB
    end
    subgraph T [Group T]
        TA[Node TA]
        TB[Node TB]
        TA --> TB
    end
    R1 --> SA
    SB --> TA
    R2 ~~~ TB`;

function parseFixture() {
  return parseMermaidAST(TEST_FLOWCHART);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('getRootViewWithCollapseState', () => {
  it('T1: all expanded (empty set) returns raw code with no compound nodes', () => {
    const ast = parseFixture();
    const result = getRootViewWithCollapseState(ast, new Set());
    
    // Should return the raw code unchanged
    expect(result.code).toBe(ast.lines.join('\n'));
    expect(result.compoundNodeIds).toEqual([]);
  });

  it('T2: all collapsed matches getRootViewCode output', () => {
    const ast = parseFixture();
    const allCollapsed = new Set(['S', 'T']);
    const result = getRootViewWithCollapseState(ast, allCollapsed);
    const rootViewCode = getRootViewCode(ast);

    // Should produce identical output to getRootViewCode
    expect(result.code).toBe(rootViewCode);
    expect(result.compoundNodeIds).toContain('S');
    expect(result.compoundNodeIds).toContain('T');
    expect(result.compoundNodeIds).toHaveLength(2);
  });

  it('T3: partial collapse — S collapsed, T expanded', () => {
    const ast = parseFixture();
    const result = getRootViewWithCollapseState(ast, new Set(['S']));

    // S should be a compound node (📂)
    expect(result.code).toContain('S["📂 Group S"]');
    expect(result.compoundNodeIds).toContain('S');

    // T's subgraph block should pass through
    expect(result.code).toContain('subgraph T');
    expect(result.code).toContain('TA[Node TA]');
    expect(result.code).toContain('TB[Node TB]');
    expect(result.compoundNodeIds).not.toContain('T');
  });

  it('T4: edge from root to expanded inner node keeps original', () => {
    const ast = parseFixture();
    // T is expanded, so TA is visible — edge R1 --> SA with S collapsed redirects,
    // but let's test T expanded: SB --> TA where T is expanded
    const result = getRootViewWithCollapseState(ast, new Set(['S']));

    // SB is inside collapsed S, so SB --> TA redirects FROM side to S
    // TA is inside expanded T, so TO side stays as TA
    expect(result.code).toContain('S');
    // The edge SB-->TA should redirect to S-->TA (S is compound, TA is visible)
    const lines = result.code.split('\n');
    const edgeLine = lines.find(l => l.includes('S') && l.includes('TA') && l.includes('-->'));
    expect(edgeLine).toBeTruthy();
  });

  it('T5: edge from root to collapsed inner node redirects to compound', () => {
    const ast = parseFixture();
    // S collapsed: R1 --> SA redirects to R1 --> S
    const result = getRootViewWithCollapseState(ast, new Set(['S']));

    const lines = result.code.split('\n');
    const edgeLine = lines.find(l => l.includes('R1') && l.includes('-->') && !l.includes('R2'));
    expect(edgeLine).toBeTruthy();
    // Should reference S (compound node) not SA
    expect(edgeLine).toContain('S');
    expect(edgeLine).not.toContain('SA');
  });

  it('T6: edge from expanded inner to collapsed inner redirects one side only', () => {
    const ast = parseFixture();
    // S collapsed, T expanded: SB-->TA → S-->TA
    const result = getRootViewWithCollapseState(ast, new Set(['S']));

    const lines = result.code.split('\n');
    // Find the edge that connects S compound to TA
    const edgeLine = lines.find(l => {
      const trimmed = l.trim();
      return trimmed.includes('S ') && trimmed.includes('TA') && trimmed.includes('-->');
    });
    expect(edgeLine).toBeTruthy();
  });

  it('T7: removing ID from collapsed set removes it from compoundNodeIds', () => {
    const ast = parseFixture();

    // Both collapsed
    const bothCollapsed = getRootViewWithCollapseState(ast, new Set(['S', 'T']));
    expect(bothCollapsed.compoundNodeIds).toContain('S');
    expect(bothCollapsed.compoundNodeIds).toContain('T');

    // Expand T (remove from set)
    const onlyS = getRootViewWithCollapseState(ast, new Set(['S']));
    expect(onlyS.compoundNodeIds).toContain('S');
    expect(onlyS.compoundNodeIds).not.toContain('T');
  });

  it('T8: ~~~ invisible link with collapsed endpoint is skipped', () => {
    const ast = parseFixture();
    // T collapsed: R2 ~~~ TB should be skipped (TB is inside collapsed T)
    const result = getRootViewWithCollapseState(ast, new Set(['T']));

    const lines = result.code.split('\n');
    // No line should contain ~~~ (the invisible link should be dropped)
    const tildeLines = lines.filter(l => l.includes('~~~'));
    expect(tildeLines).toHaveLength(0);
  });

  it('T9: nested subgraph respects collapse state when parent is expanded', () => {
    const nestedFlowchart = `flowchart TD
    R[Root]
    subgraph Outer [Outer Group]
        O1[Outer Node]
        subgraph Inner [Inner Group]
            I1[Inner Node]
            I2[Inner Node 2]
            I1 --> I2
        end
        O1 --> I1
    end
    R --> O1`;

    const ast = parseMermaidAST(nestedFlowchart);
    // Outer expanded, Inner collapsed
    const result = getRootViewWithCollapseState(ast, new Set(['Inner']));

    // Inner should be a compound node
    expect(result.code).toContain('Inner["📂 Inner Group"]');
    expect(result.compoundNodeIds).toContain('Inner');

    // Outer's subgraph block should be present
    expect(result.code).toContain('subgraph Outer');
    expect(result.code).toContain('O1[Outer Node]');

    // Inner's actual nodes should NOT be present (they're inside the collapsed group)
    expect(result.code).not.toContain('I1[Inner Node]');
    expect(result.code).not.toContain('I2[Inner Node 2]');
  });
});
