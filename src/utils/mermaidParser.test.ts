/**
 * mermaidParser.test.ts — Unit tests for the per-canvas collapse system.
 *
 * Tests getRootViewWithCollapseState() and verifies edge redirection,
 * compound node tracking, and the collapse/expand cycle.
 */
import { describe, it, expect } from 'vitest';
import { parseMermaidAST, getRootViewCode, getRootViewWithCollapseState, getScopeViewCode, getScopePath } from './mermaidParser';

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

const HELL_GROUPING_FIXTURE = `flowchart LR
    UO1[USER OBJECTIVES Extremely long objective label from a non technical user]

    subgraph Launch Strategy
        direction TB
        A0[Start Project] --> A1{Launch Phase}
        A1 -->|Phase 2| A3[Prepare Android App for Google Play Store]
    end

    subgraph App Entry and Core Screens
        direction TB
        B1[Splash Screen]
        B2[Home Page Upcoming Events]
        B2 --> B6[Profile Settings Page]
    end

    subgraph Legal and Compliance
        direction TB
        C1[Privacy Policy]
        B6 --> C1
        A3 --> C5[Add Legal Links Inside App and Website]
        A3 --> C6[Add Privacy Policy URL to Google Play Listing]
    end

    subgraph Customer Event Listing Features
        direction TB
        F1[Show Event Flyer]
    end

    subgraph Customer Journey
        direction TB
        I1[Home]
    end

    subgraph Backend Services
        direction TB
        P1[Authentication Service]
        P3[Password Reset Service]
    end

    subgraph Database and Storage
        direction TB
        Q19[(Password Reset Tokens)]
    end

    P3 --> Q19
    style UO1 fill:#fff266,stroke:#333,stroke-width:2px,color:#000`;

const STUDENT_SUPPORT_FIXTURE = `flowchart TD
    A[Student visits Customer Service] --> B[Customer Service logs pre-ticket]
    B --> C[Route ticket based on issue]
    C --> D{Is support unit or faculty in the space?}

    D -- Yes --> E[Support unit or faculty resolves issue in person]
    E --> F[Student provides update on resolution]
    F --> G{Was the issue resolved?}
    G -- Yes --> H[Mark ticket resolved / close ticket]
    G -- No --> I[Escalate ticket]

    D -- No --> J1

    subgraph J[Virtual routing to support unit or faculty]
        J1[Asha sends ticket to pool]
        J2[EAS admin reviews ticket pool]
        J3[EAS admin routes ticket to responsible person]
        J5{Does responsible person have a SolarWinds license?}
        J6[Responsible person updates ticket status or reroutes in SolarWinds as needed]
        J7[Responsible person resolves issue and emails EAS admin]
        J8[EAS admin updates ticket with emailed resolution]

        J1 --> J2 --> J3 --> J5
        J5 -- Yes --> J6
        J5 -- No --> J7 --> J8
    end

    J6 --> K[Wait for response from EAS admin]
    J8 --> K
    K --> L[Customer Service updates student after EAS admin response]
    L --> M{Should ticket be closed or escalated?}
    M -- Close --> H
    M -- Escalate --> I`;

const EXPAND_OPEN_LABEL_PARITY_FIXTURE = `flowchart TD
    subgraph Parent [Parent Group]
        P1[Parent start]
        P1 --> P2
        subgraph Hidden [Hidden Child]
            H1[Hidden child step]
        end
        H1 --> P2[Parent node label defined by redirected child edge]
    end`;

const MARKETPLACE_EXPANDED_GROUP_FIXTURE = `flowchart TD
    Market[Marketplace]
    Published[My Published Skills]
    Drafts[My Drafts]

    subgraph DraftFlow[Author Draft And Publish Flow]
        direction TD
        Drafts --> D1[Author creates or edits private draft skill]
        D1 --> DB1[(skill notes stores author draft state)]
        DB1 --> D2[User interface shows draft saved]
        D2 --> D3{Author publishes}
        D3 -- Yes --> D7[Create immutable published version v1]
        D7 --> DB2[(skill note versions stores immutable snapshot)]
    end

    subgraph MarketplaceInstall[Marketplace Install Flow]
        direction TD
        Market --> M1[User opens marketplace]
    end

    subgraph PublishedManagement[Published Skill Management Flow]
        direction TD
        Published --> P1[Owner opens published skill]
    end`;

const PLUGIN_SCOPE_BOUNDARY_FIXTURE = `flowchart TD
    subgraph CANVAS[IntelliDraw Canvas]
        A[Canvas Surface]
        B[Current Mermaid Code Snapshot]
        T[Visual UI Update]

        subgraph SKILLS[Skills Panel / Plugin System]
            C[Skills Panel Entry Point]
            D{Attach Scope}
            E[Global Plugin Installation]
            F[Local Canvas Plugin Installation]
            G[Plugin Container]
            H[Skill-as-Plugin Wrapper]
            I[Prompt Injection Container]
            J[Context Reader]
            K[Context Injector]
        end
    end

    subgraph LLM_PIPELINE[LLM Processing Pipeline]
        PI[Prompt Injections]
        N[Updated Mermaid Output]
    end

    A --> B
    B --> J
    I --> K
    K --> PI
    N --> T
    T --> A`;

const SACRED_ROUTER_FIXTURE = `flowchart TD
    A["User Question Received"]

    subgraph L0["Layer 0<br>Sacred Discernment Router"]
        direction TD
        B["Receive and Discern Question"]
        C{"Question Type"}
        H["End with Reflective Question or Quiet Observation"]

        B --> C
        C -->|"Factual practical technical casual"| H
    end

    subgraph L1["Layer 1<br>Listener Layer"]
        direction TD
        I["Listen Compassionately"]
        L["Create Structured Emotional Summary"]

        I --> L
    end

    subgraph L2["Layer 2<br>Scripture and Wisdom Mapper"]
        direction TD
        M["Map Emotional State to Biblical Wisdom"]
    end

    A --> B
    C -->|"Emotional pain fear grief shame loneliness confusion longing"| I
    L --> M`;

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

    // Edges pointing into the collapsed child should redirect to the compound node
    // instead of resurrecting hidden child nodes as Mermaid-created phantom nodes.
    expect(result.code).toContain('O1 --> Inner');
    expect(result.code).not.toContain('O1 --> I1');
  });
});

describe('hell flowchart grouping edge cases', () => {
  it('H1: title-only multi-word subgraphs get unique stable IDs and full labels', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);

    expect(ast.subgraphs.map(sg => sg.id)).toEqual([
      'Launch_Strategy',
      'App_Entry_and_Core_Screens',
      'Legal_and_Compliance',
      'Customer_Event_Listing_Features',
      'Customer_Journey',
      'Backend_Services',
      'Database_and_Storage',
    ]);
    expect(ast.subgraphs.map(sg => sg.label)).toContain('App Entry and Core Screens');
    expect(ast.subgraphs.map(sg => sg.label)).toContain('Customer Event Listing Features');
    expect(ast.subgraphs.map(sg => sg.label)).toContain('Customer Journey');
  });

  it('H2: cross-group edge lines inside a subgraph do not steal nodes from their original groups', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const launch = ast.allSubgraphsFlat.get('Launch_Strategy')!;
    const appEntry = ast.allSubgraphsFlat.get('App_Entry_and_Core_Screens')!;
    const legal = ast.allSubgraphsFlat.get('Legal_and_Compliance')!;

    expect(launch.directNodes).toContain('A3');
    expect(appEntry.directNodes).toContain('B6');
    expect(legal.directNodes).toEqual(expect.arrayContaining(['C1', 'C5', 'C6']));
    expect(legal.directNodes).not.toContain('A3');
    expect(legal.directNodes).not.toContain('B6');
  });

  it('H3: collapsing every title-only group preserves all compound groups and redirects cross-group edges', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set(ast.allSubgraphsFlat.keys()));

    expect(result.code).toContain('Launch_Strategy["📂 Launch Strategy"]');
    expect(result.code).toContain('App_Entry_and_Core_Screens["📂 App Entry and Core Screens"]');
    expect(result.code).toContain('Legal_and_Compliance["📂 Legal and Compliance"]');
    expect(result.code).toContain('Customer_Event_Listing_Features["📂 Customer Event Listing Features"]');
    expect(result.code).toContain('Customer_Journey["📂 Customer Journey"]');
    expect(result.compoundNodeIds).toEqual(expect.arrayContaining([
      'Launch_Strategy',
      'App_Entry_and_Core_Screens',
      'Legal_and_Compliance',
      'Customer_Event_Listing_Features',
      'Customer_Journey',
      'Backend_Services',
      'Database_and_Storage',
    ]));

    expect(result.code).toContain('App_Entry_and_Core_Screens --> Legal_and_Compliance');
    expect(result.code).toContain('Launch_Strategy --> Legal_and_Compliance');
    expect(result.code).toContain('Backend_Services --> Database_and_Storage');
    expect(result.code).toContain('style UO1 fill:#fff266,stroke:#333,stroke-width:2px,color:#000');
  });

  it('H4: expanding only Legal keeps external groups outside the Legal subgraph and preserves inline labels', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const collapsed = new Set(ast.allSubgraphsFlat.keys());
    collapsed.delete('Legal_and_Compliance');
    const result = getRootViewWithCollapseState(ast, collapsed);
    const lines = result.code.split('\n');
    const legalStart = lines.findIndex(line => line.includes('subgraph Legal and Compliance'));
    const legalEnd = lines.findIndex((line, index) => index > legalStart && line.trim() === 'end');
    const legalBlock = lines.slice(legalStart, legalEnd + 1).join('\n');

    expect(legalBlock).toContain('C5[Add Legal Links Inside App and Website]');
    expect(legalBlock).toContain('C6[Add Privacy Policy URL to Google Play Listing]');
    expect(legalBlock).not.toContain('Launch_Strategy --> C5');
    expect(legalBlock).not.toContain('Launch_Strategy --> C6');
    expect(legalBlock).not.toContain('App_Entry_and_Core_Screens --> C1');

    expect(result.code).toContain('Launch_Strategy --> C5');
    expect(result.code).toContain('Launch_Strategy --> C6');
    expect(result.code).toContain('App_Entry_and_Core_Screens --> C1');
  });

  it('H5: scoped views turn externally owned endpoints into boundary stubs', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const result = getScopeViewCode(ast, 'Legal_and_Compliance');

    expect(result.code).toContain('C1[Privacy Policy]');
    expect(result.code).toContain('C5[Add Legal Links Inside App and Website]');
    expect(result.code).toContain('_ext_B6[Profile Settings Page]');
    expect(result.code).toContain('_ext_A3[Prepare Android App for Google Play Store]');
    expect(result.code).toContain('_ext_B6 -.-> C1');
    expect(result.code).toContain('_ext_A3 -.-> C5');
    expect(result.boundaryNodeIds).toEqual(expect.arrayContaining(['_ext_B6', '_ext_A3']));
  });

  it('H6: boundary stubs preserve database/cylinder shapes for storage nodes', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const result = getScopeViewCode(ast, 'Backend_Services');

    expect(result.code).toContain('_ext_Q19[(Password Reset Tokens)]');
    expect(result.code).toContain('P3 -.-> _ext_Q19');
    expect(result.boundaryNodeIds).toContain('_ext_Q19');
  });
});

describe('student support collapse regression', () => {
  it('keeps boundary-adjacent node labels when a group is collapsed', () => {
    const ast = parseMermaidAST(STUDENT_SUPPORT_FIXTURE);
    const group = ast.allSubgraphsFlat.get('J')!;

    expect(group.directNodes).toContain('J1');
    expect(ast.rootNodes).not.toContain('J1');
    expect(ast.rootNodes).toContain('K');

    const result = getRootViewWithCollapseState(ast, new Set(['J']));

    expect(result.code).toContain('J["📂 Virtual routing to support unit or faculty"]');
    expect(result.code).toContain('D -->|No| J');
    expect(result.code).toContain('K[Wait for response from EAS admin]');
    expect(result.code).toContain('J --> K');
    expect(result.code).not.toContain('D -- No --> J1');
    expect(result.code).not.toContain('J1 --> J');
  });

  it('uses the same missing-label repair when expanding a group as when opening it', () => {
    const ast = parseMermaidAST(EXPAND_OPEN_LABEL_PARITY_FIXTURE);
    const expandedParent = getRootViewWithCollapseState(ast, new Set(['Hidden']));
    const openedParent = getScopeViewCode(ast, 'Parent', new Set(['Hidden']));

    expect(expandedParent.code).toContain('P2[Parent node label defined by redirected child edge]');
    expect(expandedParent.code).toContain('Hidden --> P2');

    expect(openedParent.code).toContain('P2[Parent node label defined by redirected child edge]');
    expect(openedParent.code).toContain('Hidden --> P2');
  });

  it('preserves inline database and decision labels inside an expanded group with collapsed siblings', () => {
    const ast = parseMermaidAST(MARKETPLACE_EXPANDED_GROUP_FIXTURE);
    const expandedDraftFlow = getRootViewWithCollapseState(
      ast,
      new Set(['MarketplaceInstall', 'PublishedManagement'])
    );
    const openedDraftFlow = getScopeViewCode(ast, 'DraftFlow', new Set(['MarketplaceInstall', 'PublishedManagement']));

    expect(expandedDraftFlow.code).toContain('D1 --> DB1[(skill notes stores author draft state)]');
    expect(expandedDraftFlow.code).toContain('D2 --> D3{Author publishes}');
    expect(expandedDraftFlow.code).toContain('D7 --> DB2[(skill note versions stores immutable snapshot)]');

    expect(openedDraftFlow.code).toContain('D1 --> DB1[(skill notes stores author draft state)]');
    expect(openedDraftFlow.code).toContain('D2 --> D3{Author publishes}');
    expect(openedDraftFlow.code).toContain('D7 --> DB2[(skill note versions stores immutable snapshot)]');
  });

  it('redirects scoped boundary edges from hidden collapsed child nodes to the visible child group', () => {
    const ast = parseMermaidAST(PLUGIN_SCOPE_BOUNDARY_FIXTURE);
    const openedCanvas = getScopeViewCode(ast, 'CANVAS', new Set(['SKILLS']));

    expect(openedCanvas.code).toContain('SKILLS["📂 Skills Panel / Plugin System"]');
    expect(openedCanvas.code).toContain('_ext_PI[Prompt Injections]');
    expect(openedCanvas.code).toContain('SKILLS -.-> _ext_PI');
    expect(openedCanvas.code).toContain('_ext_N -.-> T');
    expect(openedCanvas.code).not.toContain('K -.-> _ext_PI');
    expect(openedCanvas.code).not.toContain('K[Context Injector]');
  });

  it('uses quoted external node labels in opened scopes and strips HTML from breadcrumbs', () => {
    const ast = parseMermaidAST(SACRED_ROUTER_FIXTURE);
    const openedListener = getScopeViewCode(ast, 'L1', new Set(['L0', 'L2']));

    expect(openedListener.code).toContain('_ext_C{Question Type}');
    expect(openedListener.code).toContain('_ext_M["Map Emotional State to Biblical Wisdom"]');
    expect(openedListener.code).toContain('_ext_C -.-> I');
    expect(openedListener.code).toContain('L -.-> _ext_M');
    expect(openedListener.code).not.toContain('_ext_C{C}');
    expect(openedListener.code).not.toContain('_ext_M["M"]');

    expect(getScopePath(ast, 'L1')).toEqual([
      { id: 'L1', label: 'Layer 1 Listener Layer' },
    ]);
  });
});

describe('getScopeViewCode', () => {
  it('T1: should include internal edges defined outside the subgraph block', () => {
    const code = `flowchart TD
    subgraph Save [Group Save]
        S1[User Click Save]
        S2[System Access Database]
        S3[Commit to Memory]
        D[Database Saved Data Schema]
    end
    subgraph Pull [Group Pull]
        F1[File 1]
        F2[File 2]
    end
    S1 --> S2 --> S3 --> D --> Pull
    S3 -->|paging| F2`;
    
    const ast = parseMermaidAST(code);
    const scopeResult = getScopeViewCode(ast, 'Save');
    
    // Check that internal edges defined outside are rendered
    expect(scopeResult.code).toContain('S1 --> S2');
    expect(scopeResult.code).toContain('S2 --> S3');
    expect(scopeResult.code).toContain('S3 --> D');
    
    // Check that the boundary edge pointing to Pull is rendered as dotted
    expect(scopeResult.code).toContain('D -.-> _ext_Pull');
    // Check that boundary edge to F2 is rendered as dotted
    expect(scopeResult.code).toContain('S3 -.-> _ext_F2');
  });
});
