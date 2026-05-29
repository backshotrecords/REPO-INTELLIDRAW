# Local Component Simulator Instructions

Use this guide when you want a coding agent to create or extend a local-only React/Vite simulator inside the IntelliDraw repository for prototyping UI components before copying approved work into the production app.

## Goal

Create one sandbox folder inside the main repo that:

- lives only on this machine
- is ignored by git
- can run as a small Vite React TypeScript app
- reuses the parent repo dependencies when possible
- lets us prototype isolated components safely
- can host many small self-contained micro-simulators
- visually matches the production IntelliDraw app when components are being tested
- gives us a clean place to refine a UI before copying it into the real app

## Important Repo Context

The production IntelliDraw app runs through Vercel serverless API functions. Do not rely on the deprecated root development server for production behavior.

The simulator is allowed to run locally because it is not the app server. It is only a local component sandbox.

## Folder Strategy

Use one shared local-only host:

```text
simulator/
```

Future experiments should usually live inside this same `simulator/` app as individual micro-simulators, not as brand-new nested Vite repos.

```text
simulator/
  src/
    simulators/
      canvas-skills-panel/
      prompt-composer/
      toolbar-redesign/
```

Only create a second top-level simulator folder if the user explicitly asks for a separate runtime or the experiment truly needs different tooling.

## Git Ignore

Add the simulator folder to the root `.gitignore`.

Example:

```gitignore
# Local-only component sandbox
simulator/
```

This is important. The simulator should not be committed unless the user explicitly changes that decision.

## Recommended File Structure

```text
simulator/
  index.html
  package.json
  README.md
  tsconfig.json
  vite.config.ts
  src/
    App.tsx
    main.tsx
    styles.css
    vite-env.d.ts
    shared/
      design-tokens.css
      mock-shell.tsx
      mock-data.ts
    simulators/
      canvas-skills-panel/
        README.md
        CHANGELOG.md
        index.tsx
        mockData.ts
        notes.md
      your-next-simulator/
        README.md
        CHANGELOG.md
        index.tsx
        mockData.ts
        notes.md
```

Each folder under `src/simulators/` should be small enough that another coding agent can work inside it with minimal repo context. Include a short `README.md` explaining what production component or workflow it mirrors, what mock data it uses, and what still needs to be copied back into production.

Each micro-simulator must also maintain a `CHANGELOG.md`. Update it whenever simulator behavior changes in a way that matters for production handoff. Use it to capture user-approved decisions, rejected or concept-only ideas, interaction details, data/API implications, and the specific production work that will be needed later.

## Package Setup

The simulator should usually reuse the parent repo `node_modules` instead of installing a second dependency tree.

Use scripts like this:

```json
{
  "name": "intellidraw-simulator",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "node ../node_modules/vite/bin/vite.js --host 127.0.0.1",
    "build": "npm run typecheck && node ../node_modules/vite/bin/vite.js build",
    "preview": "node ../node_modules/vite/bin/vite.js preview --host 127.0.0.1",
    "typecheck": "node ../node_modules/typescript/lib/tsc.js --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "typescript": "~6.0.2",
    "vite": "^8.0.4",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {}
}
```

If the simulator needs a dependency that does not already exist in the parent repo, ask before installing it.

## Vite Config

Use a separate simulator port so it does not conflict with the real app.

Example:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: false
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: false
  }
});
```

## TypeScript Config

Use a normal strict React TypeScript setup:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

## Index HTML

If the simulator component needs to look like production IntelliDraw, load the same fonts and icon family as the production app.

Use:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
<link
  href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
  rel="stylesheet"
/>
```

## Styling Parity Rule

When the user asks for a simulator component that should match the production app, do not create a generic mock style.

Instead:

1. Inspect the production component being simulated.
2. Inspect global styles and design tokens:
   - `src/index.css`
   - `tailwind.config.ts`
   - the production component file
   - any nearby CSS or utility classes used by that feature
3. Match:
   - fonts
   - colors
   - spacing
   - border radius
   - shadows
   - icon family
   - icon names
   - hover/focus/active states
   - mobile touch target sizes
   - scroll behavior
   - disabled states
4. If the production app uses Material Symbols, use the same icon names in the simulator.
5. If a new feature needs a new icon, propose it clearly and make the simulator use the recommended icon.

## Production Design Tokens

The current IntelliDraw visual language uses:

- Heading font: `Manrope`
- Body/UI font: `Inter`
- Icon family: `Material Symbols Outlined`
- Primary color: `#041627`
- Secondary color: `#0058bc`
- Surface: `#f7fafc`
- Surface container high: `#e5e9eb`
- Surface container lowest: `#ffffff`
- On surface: `#181c1e`
- On surface variant: `#44474c`
- Outline variant: `#c4c6cd`
- Error: `#ba1a1a`

For Material Symbols, include:

```css
.material-symbols-outlined {
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
  vertical-align: middle;
  user-select: none;
}

.material-symbols-outlined.fill {
  font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
}
```

## Component Isolation Rule

The simulator should show the component by itself, not a full fake app, unless the surrounding context is needed to test it.

For example, for the Canvas Skills panel:

- show the panel alone
- include realistic mock local/global skills inside the panel
- include local-only interaction state
- do not call production APIs from the simulator
- do not require auth
- do not require Supabase

## Micro-Simulator Rule

Use the shared `simulator/` Vite app as the host, and make each future experiment a micro-simulator folder under `simulator/src/simulators/`.

A micro-simulator should:

- export one main React component from its `index.tsx`
- include a `CHANGELOG.md` for simulator decisions and production handoff notes
- keep mock data inside its own folder when possible
- use shared simulator tokens or shell components only when helpful
- avoid importing production code unless exact parity requires it
- never be imported by production code
- include enough local interaction state to validate the UI idea
- stay small enough that an agent can understand it without reading the whole app

The simulator host can expose a simple selector, tabs, route map, or hardcoded import in `App.tsx` to choose which micro-simulator is currently being viewed.

For IntelliDraw, prefer a front-page simulator lobby:

- `simulator/src/App.tsx` owns a `simulators` registry array.
- Each registry entry has an id, title, short description, icon, status, and component.
- The page shows a left-side or top menu of available micro-simulators.
- Selecting a menu item renders that micro-simulator in the preview area.
- The currently selected simulator should be clear without requiring URL knowledge.

Example registry shape:

```ts
const simulators = [
  {
    id: "canvas-skills-panel",
    title: "Canvas Skills Panel",
    eyebrow: "Canvas UI",
    description: "Isolated Skills attachment panel with global/local scope and run modes.",
    status: "Active",
    icon: "auto_awesome",
    component: CanvasSkillsMenuSimulator,
  },
];
```

When adding a future micro-simulator, create its folder first, then register it in this array.

## Mock Data Rule

Use realistic mock data shaped like the production data.

For Skills attachments, model:

- skill id
- title
- description
- instructions
- scope: `local` or `global`
- trigger mode: `automatic`, `manual`, or `contextual`
- active state
- update availability

Keep mock behavior local to React state.

## Simulator Interaction Rule

Build enough interaction to test the UI idea.

For the Canvas Skills panel, the simulator should support:

- toggling active/inactive
- add skill drawer
- local/global selection
- auto/manual/context selection
- edit mode
- per-skill expanded config
- delete action
- manual run button
- Add to Context button
- context draft preview when useful

If a component will later call a production API, simulate the state transition locally first.

## Mobile Touch Target Rule

When testing mobile-friendly UI:

- keep destructive actions hidden until edit mode or explicit expansion
- make primary actions large enough to tap comfortably
- avoid tiny adjacent buttons for delete/run/context
- use an edit mode when several management actions would crowd a row
- keep chevrons quiet by default and reveal background on hover/focus/active

## Copying Back Into Production

When the simulator version is approved:

1. Copy the component pattern into the production component.
2. Replace local mock state with production API calls and real types.
3. Keep visual styles as close as possible to the simulator.
4. Verify production data flows:
   - read/list
   - create
   - update
   - delete
   - loading
   - errors
5. Add or update serverless API functions if the component needs new persisted behavior.
6. Update TypeScript types shared by frontend and API.
7. Update database migration SQL if a new persisted value or column is required.
8. Run:

```powershell
npm run build
```

Do not rely on the deprecated root development server for production validation.

## Database and API Rule

If the simulator introduces a new persisted option, such as a new enum-like value:

1. Update frontend types.
2. Update API validation.
3. Update Vercel serverless functions.
4. Update SQL migration files.
5. Add a focused migration file when useful.
6. Make frontend errors visible instead of only logging them.

For example, adding `trigger_mode = contextual` requires:

- frontend type union update
- attachment create/update API validation update
- Supabase check constraint update
- a migration SQL file that can be run before deployment

## Optimistic UI Rule

For small config changes, prefer optimistic UI:

1. Update the row immediately.
2. Send the Vercel API request.
3. Keep the server response if it succeeds.
4. Roll back to the previous state if it fails.
5. Show the error inside the component.

This keeps the UI feeling responsive, especially on mobile.

## Error Visibility Rule

Do not swallow simulator or production interaction errors silently.

For production components:

- show a small inline message inside the panel
- keep console logging for debugging
- use specific API errors when possible

For the contextual Skills work, this was important because the UI could send `contextual` before the Supabase check constraint had been migrated.

## Running The Simulator

Run commands from the shared `simulator/` folder, not from an individual micro-simulator folder.

```powershell
cd simulator
npm run dev
```

Build/type-check from the same folder:

```powershell
cd simulator
npm run build
```

For an individual simulation, still run the shared host app from `simulator/`. Then choose the micro-simulator through whatever selector, tab, route, or hardcoded `App.tsx` import the simulator host provides.

Do not `cd` into `simulator/src/simulators/canvas-skills-panel/` and run `npm run dev` there. Those folders are component workspaces, not separate Vite projects.

If the user prefers to open it manually, do not start the server yourself. Just give them the command.

## Handoff Checklist For Another Agent

Before saying the simulator is ready:

- `.gitignore` includes the simulator folder.
- `package.json` scripts use the parent repo Vite/TypeScript binaries.
- `index.html` imports the same fonts/icons when visual parity matters.
- `vite.config.ts` uses a separate local port.
- `npm run build` passes from inside the simulator.
- The simulated component uses realistic mock data.
- The component is isolated and easy to inspect.
- The README explains what the simulator shows.
- The micro-simulator `CHANGELOG.md` records meaningful simulator decisions and production handoff notes.
- Future experiments are added under `simulator/src/simulators/` unless a separate runtime is explicitly needed.
- Commands are run from `simulator/`, not from individual micro-simulator folders.
- No production API calls are made from the simulator.
- If the component was copied into production, root `npm run build` passes.
