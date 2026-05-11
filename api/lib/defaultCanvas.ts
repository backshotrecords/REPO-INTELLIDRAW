export const DEFAULT_CANVAS_TITLE = "Welcome to IntelliDraw!";

export const DEFAULT_MERMAID_CODE = `flowchart TD
    UO[USER OBJECTIVES: The user is trying to create an introductory flowchart that helps new IntelliDraw users understand common Mermaid node types, decision paths, labeled arrows, colored nodes, legends, group nodes, and how flowchart orientation can be changed]

    ORIENT[Important orientation note<br>To change the orientation edit the first line<br>Use flowchart TD for top down<br>Use flowchart LR for left to right<br>Use flowchart BT for bottom to top<br>Use flowchart RL for right to left]

    UO --> ORIENT
    ORIENT --> INTRO[Mermaid node types in IntelliDraw]

    INTRO --> SQ[Standard square node]
    INTRO --> RN(Rounded node)
    INTRO --> DB[(Database node)]
    INTRO --> DEC{Decision node}
    INTRO --> TERM([Start or end terminal])
    INTRO --> SUB[[Subroutine node]]
    INTRO --> CIR((Circle connector))
    INTRO --> IO[/Input output node/]
    INTRO --> HEX{{Preparation hexagon}}
    INTRO --> ASY>Asymmetric node]

    DEC -->|Yes| YES[Yes path]
    DEC -->|No| GROUPNOTE

    subgraph GROUPNODE[You can also make group nodes with it]
        direction TB
        GROUPNOTE[You can also group entire sets of nodes in a group node]
        GROUPNOTE --> COLOR{Do you want the color red or blue}

        COLOR -->|Red| RED[You can ask the agent to create a red node]
        COLOR -->|Blue| BLUE[You can ask the agent to create a blue node]

        subgraph LEGEND[You can also create legends to know what each color means]
            direction TB
            LRED[Red means red node]
            LBLUE[Blue means blue node]
        end

        BLUE ~~~ LRED
    end

    classDef objective fill:#fff3b0,stroke:#d6a800,color:#000
    classDef note fill:#e8f4ff,stroke:#3b82f6,color:#000
    classDef redNode fill:#ffcccc,stroke:#cc0000,color:#000
    classDef blueNode fill:#cce5ff,stroke:#0066cc,color:#000
    classDef legendSection fill:#f8fafc,stroke:#64748b,color:#000
    classDef legendNode fill:#f8fafc,stroke:#64748b,color:#000
    classDef groupSection fill:#f0fdf4,stroke:#16a34a,color:#000

    class UO objective
    class ORIENT note
    class GROUPNOTE note
    class RED redNode
    class BLUE blueNode
    class LRED redNode
    class LBLUE blueNode
    class LEGEND legendSection
    class GROUPNODE groupSection`;
