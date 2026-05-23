import { describe, expect, it } from 'vitest';
import { parseMermaidAST } from './mermaidParser';
import { getRenderedClusterSubgraphId } from './mermaidDom';

function fakeCluster(id: string, labelText: string): Element {
  return {
    id,
    querySelector: (selector: string) => (
      selector === '.cluster-label'
        ? { textContent: labelText }
        : null
    ),
  } as unknown as Element;
}

describe('getRenderedClusterSubgraphId', () => {
  it('matches expanded clusters by svg id before label text', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph L1["Layer 1<br>Listener Layer"]
        A["Start"]
    end`);

    expect(getRenderedClusterSubgraphId(fakeCluster('L1', ''), ast)).toBe('L1');
  });

  it('matches cluster labels even when rendered br text loses spacing', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph L1["Layer 1<br>Listener Layer"]
        A["Start"]
    end`);

    expect(getRenderedClusterSubgraphId(fakeCluster('', 'Layer 1Listener Layer'), ast)).toBe('L1');
  });
});
