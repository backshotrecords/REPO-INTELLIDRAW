# IntelliDraw

Intellidraw is an AI powered, infinite canvas, natural language, mermaid flowchart generator/management tool.

## Tech Stack

- **Frontend:** Vite + React + TypeScript + TailwindCSS v3
- **Backend:** Vercel Serverless Functions (Node.js)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Local email/password (bcrypt, session-based)
- **AI:** OpenAI API (BYOK — Bring Your Own Key)

---

## Core Application Flow

```mermaid
flowchart TD

    %% ============================================================
    %% ENTRY POINT — App loads, check if user is authenticated
    %% ============================================================
    A[User opens IntelliDraw App] --> B{Is user logged in?}

    %% ============================================================
    %% AUTH FLOW — Simple local auth (email + password, no OAuth)
    %% Users register or log in to get a session
    %% ============================================================
    B -- No --> C[Login or Register Screen]
    C --> C1{New user?}
    C1 -- Yes --> C2[Register: email + password + display name]
    C2 --> C3[Hash password with bcrypt]
    C3 --> C4[Store user in Supabase users table]
    C4 --> D[User logs in — session created]
    C1 -- No --> C5[Login: email + password]
    C5 --> C6[Verify password hash against Supabase]
    C6 --> D

    %% ============================================================
    %% DASHBOARD — Main hub for canvas management
    %% All canvases belong to the authenticated user
    %% ============================================================
    B -- Yes --> E[Dashboard — Canvas List]
    D --> E

    %% ---- Create / Load Canvas ----
    E --> F[Create New Canvas]
    E --> G[Load Existing Canvas]
    G --> H[Fetch canvas data from Supabase]
    F --> I[Initialize empty canvas in Supabase]
    H --> J[Infinite Flowchart Canvas — Workspace]
    I --> J

    %% ============================================================
    %% WORKSPACE — The canvas editor where the magic happens
    %% Contains: Mermaid renderer, chat, upload, toggle view
    %% ============================================================

    %% ---- AI Chatbot (conversational, per-canvas) ----
    %% Chat history is persisted in Supabase alongside each canvas
    %% so conversations resume when re-opening a canvas
    J --> K[AI Chatbot — Conversational Panel]
    K --> K1[User sends message]
    K1 --> K2[Send message + current mermaid code to OpenAI]
    K2 --> K3[AI responds with suggestions]
    K3 --> K4[User clicks 'Update Flowchart' button]
    K4 --> L[Update and Render Flowchart in Mermaid]
    K1 --> K5[Persist chat message to Supabase]
    K3 --> K5

    %% ---- Toggle View: Rendered Flowchart vs Raw Mermaid Code ----
    J --> M[Toggle View: Flowchart ↔ Mermaid Markdown Code]

    %% ---- File Upload & AI Analysis ----
    %% User uploads image or document, AI analyzes and generates flowchart
    J --> N[Upload Image or Document]
    N --> O1[Send file to OpenAI Vision API]
    O1 --> O2[AI analyzes content and generates Mermaid code]
    O2 --> L

    %% ---- Canvas CRUD with Auto-Save ----
    %% Changes auto-save to Supabase with a 2-second debounce
    J --> P[Canvas CRUD — Edit, Delete, Auto-Save]
    P --> P1[Auto-save mermaid code to Supabase — 2s debounce]
    P --> P2[Rename canvas title]
    P --> P3[Delete canvas — confirm dialog]
    P3 --> E

    %% ---- Mobile Touch Support ----
    %% Pinch-zoom, two-finger pan, 48px touch targets
    J --> T[Mobile Friendly — Touch Pan, Pinch Zoom, 48px targets]

    %% ============================================================
    %% SETTINGS — API key management, model switching, profile
    %% Accessible from dashboard via bottom nav or top bar
    %% ============================================================
    E --> Q[Settings Page]

    %% ---- API Key Management ----
    %% Key is encrypted at rest in Supabase (AES-256)
    %% UI has show/hide toggle + copy-to-clipboard button
    Q --> R[OpenAI API Key Management]
    R --> R1[Enter / Paste API Key]
    R1 --> R2[Encrypt key with AES-256]
    R2 --> R3[Store encrypted key in Supabase]
    R --> R4[Show / Hide key toggle in UI]
    R --> R5[Copy key to clipboard button]
    R --> R6[Test Connection — validate key against OpenAI]

    %% ---- Model Selection ----
    %% User can add multiple model IDs and switch between them
    %% UI label shows the ACTUAL model in use, not a fixed label
    Q --> S_MODEL[AI Model Configuration]
    S_MODEL --> SM1[Add new model ID — e.g. gpt-4o, gpt-4o-mini]
    S_MODEL --> SM2[Switch active model from saved list]
    S_MODEL --> SM3[Delete saved model from list]
    SM2 --> SM4[Active model label updates across UI]

    %% ---- Profile & Account ----
    Q --> S_PROFILE[Account Details — Name, Email]
    Q --> S_LOGOUT[Logout — Destroy session]
    S_LOGOUT --> C

    %% ============================================================
    %% EXPORT — Download canvases as Markdown or ZIP
    %% Single canvas = .md file, multiple = .zip bundle
    %% ============================================================
    E --> U[Select Canvases to Export]
    U --> V{How many selected?}
    V -- 1 --> W[Export as Markdown .md file]
    V -- More than 1 --> X[Export ZIP of Markdown files]
```

---

## Database Schema (Supabase — PostgreSQL)

```mermaid
erDiagram
    USERS {
        uuid id PK
        text email UK
        text password_hash
        text display_name
        text api_key_encrypted
        text active_model_id
        timestamp created_at
    }

    AI_MODELS {
        uuid id PK
        uuid user_id FK
        text model_id
        text label
        timestamp added_at
    }

    CANVASES {
        uuid id PK
        uuid user_id FK
        text title
        text mermaid_code
        jsonb chat_history
        timestamp created_at
        timestamp updated_at
    }

    USERS ||--o{ CANVASES : "owns"
    USERS ||--o{ AI_MODELS : "configures"
```

---

## API Routes (Vercel Serverless Functions)

```mermaid
flowchart LR

    %% ---- Auth Routes ----
    subgraph Auth ["/api/auth"]
        A1["POST /register"]
        A2["POST /login"]
        A3["POST /logout"]
        A4["GET /me"]
    end

    %% ---- Canvas CRUD Routes ----
    subgraph Canvases ["/api/canvases"]
        B1["GET / — list all"]
        B2["POST / — create"]
        B3["GET /:id — get one"]
        B4["PUT /:id — update"]
        B5["DELETE /:id — delete"]
    end

    %% ---- Chat Route ----
    subgraph Chat ["/api/chat"]
        C1["POST / — send message + mermaid context"]
    end

    %% ---- Upload Route ----
    subgraph Upload ["/api/upload"]
        D1["POST / — upload file for AI analysis"]
    end

    %% ---- Settings Routes ----
    subgraph Settings ["/api/settings"]
        E1["GET / — get profile + masked key"]
        E2["PUT /apikey — save encrypted key"]
        E3["PUT /profile — update name/email"]
        E4["POST /test-connection — validate API key"]
        E5["GET /models — list saved models"]
        E6["POST /models — add model"]
        E7["DELETE /models/:id — remove model"]
        E8["PUT /models/active — switch active model"]
    end
```

---

## Navigation Flow

```mermaid
flowchart LR
    %% All primary navigational mechanisms

    subgraph Navigation Interfaces
        TOP_BAR[Top Bar]
        BOT_NAV[Bottom Nav - Mobile Only]
    end

    TOP_BAR --> HAMBURGER["Hamburger Menu (All Devices)"]
    TOP_BAR --> AVATAR["User Avatar Dropdown"]

    HAMBURGER --> HM_DASH["🗂 My Canvases"]
    HAMBURGER --> HM_NEW["✏️ New Canvas"]
    HAMBURGER --> HM_SET["⚙️ Settings"]
    HAMBURGER --> HM_LOGOUT["🚪 Log Out"]

    AVATAR --> AV_SET["⚙️ Settings"]
    AVATAR --> AV_DASH["🗂 My Canvases"]
    AVATAR --> AV_LOGOUT["🚪 Log Out"]

    BOT_NAV --> TAB_CANVASES["🗂 Canvases"]
    BOT_NAV --> TAB_DRAW["✏️ Draw"]
    BOT_NAV --> TAB_CHAT["🤖 AI Chat"]
    BOT_NAV --> TAB_SETTINGS["⚙️ Settings"]
```

---

## Key Implementation Notes

<!-- 
  These comments document critical decisions made during planning.
  Reference these when implementing to ensure consistency.
-->

### Authentication
- **Local auth only** — email + password, no OAuth/social providers
- Passwords hashed with `bcrypt` before storing in Supabase
- Sessions managed server-side (Vercel serverless compatible via JWT tokens)

### API Key Security
- API key encrypted with **AES-256** using a server-side secret (`ENCRYPTION_KEY` env var)
- Stored encrypted in the `users.api_key_encrypted` column in Supabase
- Decrypted only server-side when making OpenAI API calls
- **UI features:** show/hide toggle button + copy-to-clipboard button

### AI Model Management
- Users can register **multiple OpenAI model IDs** (e.g., `gpt-4o`, `gpt-4o-mini`, `o1-preview`)
- One model is set as **active** at a time (`users.active_model_id`)
- The **UI label always shows the actual model ID** in use — no hardcoded display names
- Model switching is done from the Settings page

### Chat History
- Chat messages are **persisted per canvas** in the `canvases.chat_history` JSONB column
- When a canvas is re-opened, the full conversation history is restored
- Each message stores: `{ role, content, timestamp }`

### Canvas Auto-Save
- Mermaid code changes trigger an auto-save to Supabase with a **2-second debounce**
- Title changes save immediately on blur

### Deployment
- **Frontend:** Vite build output deployed to Vercel
- **Backend:** All API routes as Vercel Serverless Functions (`/api/*`)
- **Database:** Supabase hosted PostgreSQL (connection via environment variable)

### UI & Navigation Design
- All layouts are **mobile-first** with responsive breakpoints (sm → md → lg)
- **Top Navigation:** Continuous top bar with a **universal hamburger menu** (all devices) opening a slide-out sidebar, and a **user avatar dropdown** for account/settings shortcuts.
- **Mobile Navigation:** Bottom navigation bar handles quick switching on mobile devices.
- **Canvas Interaction:** Supports **pinch-zoom**, **two-finger pan**, and maintains minimum **48px** touch targets per standard guidelines.
- **AI Chat Layout:**
  - On **desktop**, chat is a steady right **side panel**.
  - On **mobile**, chat is a **collapsible bottom-sheet covering the lower half of the screen**. The toggle button for this sheet sits beside the active chat input bar.