/**
 * mermaidParser.test.ts — Unit tests for the per-canvas collapse system.
 *
 * Tests getRootViewWithCollapseState() and verifies edge redirection,
 * compound node tracking, and the collapse/expand cycle.
 */
import { describe, it, expect } from 'vitest';
import { parseMermaidAST, getRootViewCode, getRootViewWithCollapseState, getScopeViewCode, getScopePath, getBoundaryRefs, findNodeScope, extractScopeCode } from './mermaidParser';

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

const COLLAB_SCOPE_CHILD_ENTRY_FIXTURE = `flowchart TD
    B[Run Two Workstreams in Parallel]
    B --> CS_Start[Canvas Sharing Workstream]

    subgraph CS[Group 2: Canvas Sharing and Real-Time Collaboration]
        CS_Start --> CSV_Start[Viewing Flow]
        CS_Start --> CSE_Start[Editing Flow]
        CS_Start --> CSU_Start[Adding, Removing, and Seeing Users Flow]

        subgraph CSV[Viewing]
            CSV_Start --> CS1[Phase 1: Shared Canvas Visibility]
            CS1 --> CS6[UI Visually Confirms Users Are Sharing the Same Canvas]
        end

        subgraph CSE[Editing]
            CSE_Start --> CS7[Phase 2: Real-Time Canvas Updates]
            CS7 --> CS11[All Viewers and Editors See the Update in Real Time]
        end

        subgraph CSU[Adding, Removing, and Seeing Users on the Canvas]
            CSU_Start --> CSU1[Open Canvas Sharing and Users Panel]
            CSU1 --> CSU10[UI Updates the Canvas User and Presence List]
        end

        CS6 --> CS7
        CSU10 -.-> CS6
        CSU10 -.-> CS11
    end`;

const ACTION_SCOPE_ANCESTOR_BOUNDARY_FIXTURE = `flowchart TD
    A[Skill Attachment Modes]
    A --> E[Action-Triggered Mode / Smooth Wave]

    subgraph ACTION[Action-Triggered Attachment Mode / Smooth Wave]
        E --> E1[Attach a scale to a selected canvas action]
        E1 --> F0[Choose supported action]

        subgraph F[Supported Actions]
            F0 --> F1[Exit Canvas]
            F0 --> F2[Copy Canvas]
            F0 --> F3[Export Code]
            F0 --> F4[Save Canvas]
            F0 --> F5[Additional actions can be added over time]
        end

        F1 --> E2[Selected action occurs]
        F2 --> E2
        F3 --> E2
        F4 --> E2
        F5 --> E2

        E2 --> E3[Run associated skill prompt]
    end`;

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

const DEFERRED_SUBGRAPH_MEMBERSHIP_FIXTURE = `flowchart TD
    A[User opens canvas] --> B1[Mic button shows small chevron or expandable menu affordance]
    B1 --> B2[User clicks chevron or menu area]
    B2 --> B3[Expandable mic mode menu pops up]
    B3 --> B4[User selects a mic mode]
    B4 --> C{Selected mic mode?}

    C -- Regular voice mode --> D[User taps mic]
    C -- Meeting mode --> J[User taps mic to start live meeting recording]

    subgraph MicModes["Mic Button Modes"]
        subgraph MicButtonExpandableMenu["Mic Button Expandable Menu"]
            B1
            B2
            B3
            B4
            C
        end
        D
        J
    end`;

const SHARED_ASSET_LAYER_FIXTURE = `flowchart TD
    subgraph Recruiting["Recruiting"]
        subgraph Travis["Owner: Travis"]
            T1["Get the people"]
            T2["Recruit the right candidates"]
            T1 --> T2
        end
    end

    subgraph Training["Training"]
        subgraph Daniel["Owner: Daniel"]
            D1["Manage coaches"]
        end
    end

    subgraph SharedAssetLayer["Shared Asset Layer"]
        subgraph Tiffany["Owner: Tiffany"]
            TF1["Measure quality of recruitment"]
        end
        subgraph Alex["Owner: Alex"]
            AL1["Ensure everyone has the right equipment"]
        end
    end

    T2 --> D1

    Tiffany -. "quality measurement across pipeline" .-> Recruiting
    Tiffany -. "quality measurement across pipeline" .-> Training
    Alex -. "equipment and technology support" .-> Recruiting
    Alex -. "equipment and technology support" .-> Training`;

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
    const openedCanvas = getScopeViewCode(ast, 'CANVAS', new Set(['SKILLS', 'LLM_PIPELINE']));

    expect(openedCanvas.code).toContain('SKILLS["📂 Skills Panel / Plugin System"]');
    expect(openedCanvas.code).toContain('_ext_LLM_PIPELINE["📂 LLM Processing Pipeline"]');
    expect(openedCanvas.code).toContain('SKILLS -.-> _ext_LLM_PIPELINE');
    expect(openedCanvas.code).toContain('_ext_LLM_PIPELINE -.-> T');
    expect(openedCanvas.code).not.toContain('_ext_PI[Prompt Injections]');
    expect(openedCanvas.code).not.toContain('_ext_N[Updated Mermaid Output]');
    expect(openedCanvas.code).not.toContain('K -.->');
    expect(openedCanvas.code).not.toContain('K[Context Injector]');
  });

  it('rewrites visible entry-node edges to collapsed child groups in opened scopes', () => {
    const ast = parseMermaidAST(COLLAB_SCOPE_CHILD_ENTRY_FIXTURE);
    const openedWithViewingExpanded = getScopeViewCode(ast, 'CS', new Set(['CSE', 'CSU']));
    const openedWithViewingCollapsed = getScopeViewCode(ast, 'CS', new Set(['CSV', 'CSE', 'CSU']));

    expect(openedWithViewingExpanded.code).toContain('CSV_Start --> CS1[Phase 1: Shared Canvas Visibility]');
    expect(openedWithViewingCollapsed.code).toContain('CSV["📂 Viewing"]');
    expect(openedWithViewingCollapsed.code).toContain('CSV_Start[Viewing Flow]');
    expect(openedWithViewingCollapsed.code).toContain('CSV_Start --> CSV');
    expect(openedWithViewingCollapsed.code).not.toContain('CSV_Start --> CS1');
  });

  it('rewrites visible entry-node edges to nested collapsed groups in expanded root views', () => {
    const ast = parseMermaidAST(COLLAB_SCOPE_CHILD_ENTRY_FIXTURE);
    const expandedParentWithCollapsedChildren = getRootViewWithCollapseState(
      ast,
      new Set(['CSV', 'CSE', 'CSU'])
    );

    expect(expandedParentWithCollapsedChildren.code).toContain('subgraph CS');
    expect(expandedParentWithCollapsedChildren.code).toContain('CSV["📂 Viewing"]');
    expect(expandedParentWithCollapsedChildren.code).toContain('CSV_Start[Viewing Flow]');
    expect(expandedParentWithCollapsedChildren.code).toContain('CSV_Start --> CSV');
    expect(expandedParentWithCollapsedChildren.code).not.toContain('CSV_Start --> CS1');
  });

  it('keeps parent-scope boundary nodes when an opened nested scope has a collapsed ancestor', () => {
    const ast = parseMermaidAST(ACTION_SCOPE_ANCESTOR_BOUNDARY_FIXTURE);
    const openedSupportedActions = getScopeViewCode(ast, 'F', new Set(['ACTION']));

    expect(openedSupportedActions.code).toContain('_ext_F0[Choose supported action]');
    expect(openedSupportedActions.code).toContain('_ext_E2[Selected action occurs]');
    expect(openedSupportedActions.code).toContain('_ext_F0 -.-> F1');
    expect(openedSupportedActions.code).toContain('_ext_F0 -.-> F5');
    expect(openedSupportedActions.code).toContain('F1 -.-> _ext_E2');
    expect(openedSupportedActions.code).toContain('F5 -.-> _ext_E2');
    expect(openedSupportedActions.code).not.toContain('_ext_ACTION');
  });

  it('uses quoted external node labels in opened scopes and strips HTML from breadcrumbs', () => {
    const ast = parseMermaidAST(SACRED_ROUTER_FIXTURE);
    const openedListener = getScopeViewCode(ast, 'L1', new Set());

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

describe('nested subgraph IDs as edge endpoints (groups inside a group)', () => {
  it('redirects root edges from nested group endpoints to the collapsed parent compound', () => {
    const ast = parseMermaidAST(SHARED_ASSET_LAYER_FIXTURE);
    // Shared Asset Layer collapsed, Recruiting/Training expanded — the state
    // that produced phantom Tiffany/Alex root nodes.
    const result = getRootViewWithCollapseState(ast, new Set(['SharedAssetLayer']));

    expect(result.code).toContain('SharedAssetLayer["📂 Shared Asset Layer"]');

    // Edges from the nested owner groups must redirect to the parent compound,
    // not leak the hidden subgraph IDs as phantom root nodes — and keep their
    // spaced dotted labels.
    expect(result.code).not.toMatch(/^\s*Tiffany\s/m);
    expect(result.code).not.toMatch(/^\s*Alex\s/m);
    expect(result.code).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Recruiting');
    expect(result.code).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Training');

    // Duplicate redirected edges (Tiffany + Alex → same targets) are deduped
    const salToRecruiting = result.code.split('\n')
      .filter(l => l.includes('SharedAssetLayer') && l.includes('Recruiting') && l.includes('->'));
    expect(salToRecruiting).toHaveLength(1);
  });

  it('redirects nested group endpoints in the all-collapsed root view', () => {
    const ast = parseMermaidAST(SHARED_ASSET_LAYER_FIXTURE);
    const result = getRootViewCode(ast);

    expect(result).not.toMatch(/^\s*Tiffany\s/m);
    expect(result).not.toMatch(/^\s*Alex\s/m);
    expect(result).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Recruiting');
    expect(result).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Training');
  });

  it('resolves the outermost collapsed ancestor when nested groups are collapsed along with the parent', () => {
    const ast = parseMermaidAST(SHARED_ASSET_LAYER_FIXTURE);
    // Both the owner groups AND the parent are collapsed (e.g. collapse-all
    // default, then expand Recruiting/Training only)
    const result = getRootViewWithCollapseState(
      ast,
      new Set(['SharedAssetLayer', 'Tiffany', 'Alex', 'Travis', 'Daniel'])
    );

    // Tiffany is collapsed but hidden inside collapsed SharedAssetLayer —
    // edges must redirect to the visible outermost compound, not to Tiffany.
    expect(result.code).not.toMatch(/^\s*Tiffany\s/m);
    expect(result.code).not.toMatch(/^\s*Alex\s/m);
    expect(result.code).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Recruiting');
    expect(result.code).toContain('SharedAssetLayer -.->|"quality measurement across pipeline"| Training');
  });

  it('captures spaced labels on dotted and thick arrows and normalizes split dotted arrows', () => {
    const ast = parseMermaidAST(`flowchart TD
    A -. dotted note .-> B
    C == thick note ==> D`);

    expect(ast.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'dotted note', arrow: '-.->' });
    expect(ast.edges[1]).toMatchObject({ from: 'C', to: 'D', label: 'thick note', arrow: '==>' });
  });

  it('keeps nested collapsed groups as visible edge endpoints when the parent is expanded', () => {
    const ast = parseMermaidAST(SHARED_ASSET_LAYER_FIXTURE);
    // Parent expanded, owner groups collapsed — Tiffany/Alex are visible
    // compound nodes inside the expanded parent, so edges pass through.
    const result = getRootViewWithCollapseState(ast, new Set(['Tiffany', 'Alex', 'Travis', 'Daniel']));

    expect(result.code).toContain('subgraph SharedAssetLayer');
    expect(result.code).toContain('Tiffany["📂 Owner: Tiffany"]');
    expect(result.code).toContain('Tiffany -. "quality measurement across pipeline" .-> Recruiting');
  });
});

describe('deferred subgraph membership declarations', () => {
  it('records bare membership nodes inside groups when labels and edges are defined earlier', () => {
    const ast = parseMermaidAST(DEFERRED_SUBGRAPH_MEMBERSHIP_FIXTURE);
    const micModes = ast.allSubgraphsFlat.get('MicModes')!;
    const expandableMenu = ast.allSubgraphsFlat.get('MicButtonExpandableMenu')!;

    expect(expandableMenu.directNodes).toEqual(['B1', 'B2', 'B3', 'B4', 'C']);
    expect(micModes.directNodes).toEqual(['D', 'J']);
  });

  it('renders child and parent scopes when grouped nodes are declared after the edge graph', () => {
    const ast = parseMermaidAST(DEFERRED_SUBGRAPH_MEMBERSHIP_FIXTURE);
    const openedMenu = getScopeViewCode(ast, 'MicButtonExpandableMenu', new Set());
    const openedMicModes = getScopeViewCode(ast, 'MicModes', new Set(['MicButtonExpandableMenu']));

    expect(openedMenu.code).toContain('B1[Mic button shows small chevron or expandable menu affordance]');
    expect(openedMenu.code).toContain('B1 --> B2');
    expect(openedMenu.code).toContain('B2 --> B3');
    expect(openedMenu.code).toContain('B3 --> B4');
    expect(openedMenu.code).toContain('B4 --> C');
    expect(openedMenu.code).toContain('C -.-> _ext_D');
    expect(openedMenu.code).toContain('C -.-> _ext_J');

    expect(openedMicModes.code).toContain('MicButtonExpandableMenu["📂 Mic Button Expandable Menu"]');
    expect(openedMicModes.code).toContain('D[User taps mic]');
    expect(openedMicModes.code).toContain('J[User taps mic to start live meeting recording]');
    expect(openedMicModes.code).toContain('MicButtonExpandableMenu -->|Regular voice mode| D');
    expect(openedMicModes.code).toContain('MicButtonExpandableMenu -->|Meeting mode| J');
  });
});

describe('audit F1/F2: subgraph IDs referenced by edges inside other groups', () => {
  const SIBLING_GROUP_EDGE_FIXTURE = `flowchart TD
    subgraph S1[Group One]
        A[Node A]
        A --> GroupB
    end
    subgraph GroupB[Group B]
        B1[Node B1]
    end`;

  it('keeps sibling group IDs out of directNodes even when declared after the edge', () => {
    const ast = parseMermaidAST(SIBLING_GROUP_EDGE_FIXTURE);
    expect(ast.allSubgraphsFlat.get('S1')!.directNodes).toEqual(['A']);
    expect(ast.rootNodes).not.toContain('GroupB');
  });

  it('classifies the cross-group edge as a boundary ref', () => {
    const ast = parseMermaidAST(SIBLING_GROUP_EDGE_FIXTURE);
    const refs = getBoundaryRefs(ast, 'S1');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ direction: 'outgoing', insideNodeId: 'A', externalNodeId: 'GroupB' });
  });

  it('renders the sibling group as a boundary stub in the opened scope, not a phantom node', () => {
    const ast = parseMermaidAST(SIBLING_GROUP_EDGE_FIXTURE);
    const opened = getScopeViewCode(ast, 'S1');
    expect(opened.code).toContain('_ext_GroupB["📂 Group B"]');
    expect(opened.code).toContain('A -.-> _ext_GroupB');
    expect(opened.code).not.toMatch(/^\s*GroupB\[Group B\]$/m);
  });

  it('keeps the collapsed sibling compound outside the referencing group block', () => {
    const ast = parseMermaidAST(SIBLING_GROUP_EDGE_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set(['GroupB']));
    const lines = result.code.split('\n');
    const s1Start = lines.findIndex(l => l.includes('subgraph S1'));
    const s1End = lines.findIndex((l, idx) => idx > s1Start && l.trim() === 'end');
    const s1Block = lines.slice(s1Start, s1End + 1).join('\n');
    expect(s1Block).not.toContain('GroupB[Group B]');
    expect(result.code).toContain('GroupB["📂 Group B"]');
    expect(result.code).toContain('A --> GroupB');
  });

  it('never emits a plain node definition for an expanded group hit by a redirected edge', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph T1[First]
        A[Node A]
    end
    A --> T2
    subgraph T2[Second]
        B[Node B]
    end`);
    const result = getRootViewWithCollapseState(ast, new Set(['T1']));
    const trimmedLines = result.code.split('\n').map(l => l.trim());
    expect(trimmedLines).not.toContain('T2[Second]');
    expect(result.code).toContain('subgraph T2[Second]');
    expect(result.code).toContain('T1 --> T2');
  });
});

describe('audit F8: bare membership lines naming a group nest it (membership-by-reference)', () => {
  const BARE_GROUP_MEMBERSHIP_FIXTURE = `flowchart TD
    subgraph S1[One]
        GroupB
    end
    subgraph GroupB[Group B]
        B1[Node B1]
    end
    B1 --> X[External]`;

  it('adopts the referenced group as a child instead of a member node', () => {
    const ast = parseMermaidAST(BARE_GROUP_MEMBERSHIP_FIXTURE);
    const s1 = ast.allSubgraphsFlat.get('S1')!;
    expect(ast.allSubgraphsFlat.get('GroupB')!.parentId).toBe('S1');
    expect(s1.children.map(c => c.id)).toContain('GroupB');
    expect(s1.directNodes).not.toContain('GroupB');
    expect(ast.subgraphs.map(s => s.id)).toEqual(['S1']);
  });

  it('renders one compound at root when everything is collapsed', () => {
    const ast = parseMermaidAST(BARE_GROUP_MEMBERSHIP_FIXTURE);
    const result = getRootViewCode(ast);
    expect(result).toContain('S1["📂 One"]');
    expect(result).not.toContain('GroupB["📂 Group B"]');
    expect(result).not.toContain('subgraph GroupB');
    expect(result).toContain('S1 --> X');
  });

  it('renders the adopted group as a compound inside the expanded adopter', () => {
    const ast = parseMermaidAST(BARE_GROUP_MEMBERSHIP_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set(['GroupB']));
    expect(result.code).toContain('subgraph S1[One]');
    expect(result.code).toContain('GroupB["📂 Group B"]');
    expect(result.code).not.toContain('subgraph GroupB');
    expect(result.code).toContain('GroupB --> X');
    expect(result.compoundNodeIds).toContain('GroupB');
  });

  it('opens the adopter scope with the adopted group as a compound child', () => {
    const ast = parseMermaidAST(BARE_GROUP_MEMBERSHIP_FIXTURE);
    const opened = getScopeViewCode(ast, 'S1');
    expect(opened.code).toContain('GroupB["📂 Group B"]');
    expect(opened.code).not.toMatch(/^\s*GroupB$/m);
    expect(opened.code).toContain('GroupB -.-> _ext_X');
  });
});

describe('audit F3: scope views honor collapse state below direct children', () => {
  it('collapses a grandchild group inside an opened scope', () => {
    const ast = parseMermaidAST(`flowchart TD
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
    end`);
    const opened = getScopeViewCode(ast, 'Top', new Set(['Grand']));
    expect(opened.code).toContain('Grand["📂 Grand"]');
    expect(opened.code).not.toContain('G1[G One]');
    expect(opened.code).not.toContain('subgraph Grand');
    expect(opened.code).toContain('C1 --> Grand');
    expect(opened.code).toContain('T1 --> C1');
  });
});

describe('audit F4: boundary stubs resolve to the outermost collapsed stand-in', () => {
  it('emits one stub for a hidden region whether the endpoint is a node or a group', () => {
    const ast = parseMermaidAST(`flowchart TD
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
    B1 --> AD1`);
    const opened = getScopeViewCode(ast, 'Beta', new Set(['AMid', 'ADeep']));
    expect(opened.code).toContain('_ext_AMid["📂 A Mid"]');
    expect(opened.code).not.toContain('_ext_ADeep');
    expect(opened.code).toContain('_ext_AMid -.-> B1');
    expect(opened.code).toContain('B1 -.-> _ext_AMid');
  });
});

describe('audit F5: findNodeScope resolves subgraph IDs to their parent scope', () => {
  it('returns the parent group for nested subgraph IDs and null for top-level ones', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph Top[Top]
        subgraph Mid[Mid]
            subgraph Inner[Inner]
                I1[I One]
            end
        end
    end`);
    expect(findNodeScope(ast, 'Inner')).toBe('Mid');
    expect(findNodeScope(ast, 'Mid')).toBe('Top');
    expect(findNodeScope(ast, 'Top')).toBeNull();
    expect(findNodeScope(ast, 'I1')).toBe('Inner');
  });
});

describe('audit F6: boundary stubs for external groups use display labels', () => {
  it('labels an expanded title-only external group with the folder icon and its title', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph S1[Group One]
        A[Node A]
    end
    subgraph Launch Strategy
        L1[Launch Node]
    end
    Launch_Strategy --> A`);
    const opened = getScopeViewCode(ast, 'S1', new Set());
    expect(opened.code).toContain('_ext_Launch_Strategy["📂 Launch Strategy"]');
    expect(opened.code).not.toContain('_ext_Launch_Strategy["Launch_Strategy"]');
    expect(opened.code).toContain('_ext_Launch_Strategy -.-> A');
  });
});

describe('audit F7: scope exports keep edges referencing the container', () => {
  it('includes container-level edges written outside the block', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph Top[Top]
        A1[A One]
    end
    A1 --> Top`);
    const exported = extractScopeCode(ast, 'Top');
    expect(exported).toContain('A1 --> Top');
  });
});

describe('audit F9: class lines keep visible subsets', () => {
  it('keeps the visible compound child in a class line that also names the scope container', () => {
    const ast = parseMermaidAST(`flowchart TD
    subgraph Top[Top]
        subgraph Mid[Mid]
            M1[M One]
        end
    end
    classDef someClass fill:#f96
    class Mid,Top someClass`);
    const opened = getScopeViewCode(ast, 'Top', new Set(['Mid']));
    expect(opened.code).toContain('classDef someClass fill:#f96');
    expect(opened.code).toContain('class Mid someClass');
    expect(opened.code).not.toContain('class Mid,Top someClass');
  });
});

describe('audit F11: title-only groups referenced by their synthetic IDs', () => {
  const TITLE_ONLY_REF_FIXTURE = `flowchart TD
    subgraph S1[Group One]
        A[Node A]
    end
    subgraph Launch Strategy
        L1[Launch Node]
    end
    Launch_Strategy --> A`;

  it('rewrites the declaration to explicit-ID form in the raw all-expanded view', () => {
    const ast = parseMermaidAST(TITLE_ONLY_REF_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set());
    expect(result.code).toContain('subgraph Launch_Strategy["Launch Strategy"]');
    expect(result.code).not.toMatch(/subgraph Launch Strategy$/m);
  });

  it('rewrites the declaration when the group is expanded in a partial-collapse view', () => {
    const ast = parseMermaidAST(TITLE_ONLY_REF_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set(['S1']));
    expect(result.code).toContain('subgraph Launch_Strategy["Launch Strategy"]');
  });

  it('leaves unreferenced title-only declarations untouched', () => {
    const ast = parseMermaidAST(HELL_GROUPING_FIXTURE);
    const collapsed = new Set(ast.allSubgraphsFlat.keys());
    collapsed.delete('Legal_and_Compliance');
    const result = getRootViewWithCollapseState(ast, collapsed);
    expect(result.code).toContain('subgraph Legal and Compliance');
  });
});

describe('root-defined nodes later declared inside a group', () => {
  // Mirrors the At-a-Glance Metrics dashboard bug: M is inline-defined at
  // root by an edge before its group declares it as a member.
  const ROOT_THEN_GROUP_FIXTURE = `flowchart TD
    B[Dashboard] --> M["At-a-Glance Metrics"]
    StageProgress[Stage Progress] --> M

    subgraph MGroup["At-a-Glance Metrics Group"]
        M["At-a-Glance Metrics"]
        M --> M1[People Reached]
        M --> M2[Pipeline Health]
    end

    M --> Overall[Overall Progress]`;

  it('assigns the node to the declaring group, matching Mermaid membership', () => {
    const ast = parseMermaidAST(ROOT_THEN_GROUP_FIXTURE);
    expect(ast.allSubgraphsFlat.get('MGroup')!.directNodes).toContain('M');
    expect(ast.rootNodes).not.toContain('M');
  });

  it('hides the node and redirects its edges when the group is collapsed', () => {
    const ast = parseMermaidAST(ROOT_THEN_GROUP_FIXTURE);
    const result = getRootViewWithCollapseState(ast, new Set(['MGroup']));

    expect(result.code).toContain('MGroup["📂 At-a-Glance Metrics Group"]');
    // No duplicate standalone node next to the compound
    expect(result.code).not.toContain('M["At-a-Glance Metrics"]');
    expect(result.code).toContain('B --> MGroup');
    expect(result.code).toContain('StageProgress --> MGroup');
    expect(result.code).toContain('MGroup --> Overall');
  });

  it('shows the node inside its opened group with boundary stubs', () => {
    const ast = parseMermaidAST(ROOT_THEN_GROUP_FIXTURE);
    const opened = getScopeViewCode(ast, 'MGroup');

    expect(opened.code).toContain('M["At-a-Glance Metrics"]');
    expect(opened.code).toContain('_ext_B -.-> M');
    expect(opened.code).toContain('M -.-> _ext_Overall');
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
