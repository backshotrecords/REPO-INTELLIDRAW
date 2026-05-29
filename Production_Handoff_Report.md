# IntelliDraw Production Handoff Report

Date: 2026-05-29  
Scope: Dashboard simulator handoff into the Vercel production app and serverless API functions.

## Executive Summary

The dashboard simulator handoff is mostly transferred into production. The production React dashboard now includes project folders, nested folder navigation, archive/long-term-memory filtering, move-to-project flows, project metadata editing, and a create chooser. The Vercel serverless API layer also has matching project and canvas persistence support through `/api/projects` and updated `/api/canvases` handlers.

I would not call the handoff fully production-verified from code review alone. The local production build and unit tests pass. The owner has confirmed the production database migration has been run and the Vercel environment variables are correct. Live Vercel deployment state was not directly verified from this workspace.

## Verification Performed

- Reviewed simulator handoff notes in `simulator/src/simulators/dashboard-view/README.md` and `CHANGELOG.md`.
- Reviewed production dashboard implementation in `src/pages/DashboardPage.tsx`.
- Reviewed production API wrappers in `src/lib/api.ts`.
- Reviewed serverless functions under `api/projects/*` and `api/canvases/*`.
- Reviewed database support in `db/migrations/migration_dashboard_projects_archive.sql` and `api/lib/db.ts`.
- Reviewed Vercel routing in `vercel.json`.
- Ran production build: `npm run build` passed.
- Ran unit tests: `npm test` passed, 3 files and 29 tests.
- Ran lint: `npm run lint` failed on existing repo-wide lint issues, not specifically on the dashboard handoff path.

## Transfer Matrix

| Simulator handoff item | Production status | Evidence |
| --- | --- | --- |
| Project folder cards above canvas grid | Transferred | `src/pages/DashboardPage.tsx` renders project sections and `ProjectCard`. |
| Project drill-in with breadcrumbs | Transferred | `activeProjectId`, `projectPath`, and `ProjectBreadcrumb` are implemented. |
| Nested project folders | Transferred | `parent_project_id` exists in types, API, migration, and dashboard filtering. |
| Create chooser for canvas vs project | Transferred | `CreateChoiceDialog` is wired to `apiCreateCanvas` and `apiCreateProject`. |
| Editable project title, description, color | Transferred | `ProjectDetailsWizard`, `apiUpdateProject`, and `accent` migration/check constraint exist. |
| Move canvas/project to folder/root | Transferred | Dashboard move dialog plus `/api/canvases/[id]` and `/api/projects/[id]` updates are present. |
| Prevent moving folder into itself/descendant | Transferred | `getProjectAndDescendantIds` is used by the project update function. |
| Archive view for projects/canvases | Transferred | `manually_archived` fields and `isLongTermMemoryItem` filtering are implemented. |
| Manual archive separate from timestamp | Transferred | Archive updates set `manuallyArchived`; real edits clear it. |
| Root dashboard excludes folder-assigned canvases | Transferred | Dashboard filters root canvases by missing `project_id`. |
| Project counts from real membership | Transferred | Counts are derived from loaded canvases, not stored mock counts. |
| Serverless API backing for production | Transferred | `/api/projects`, `/api/canvases`, and `src/lib/api.ts` wrappers are present. |
| Production DB migration | Confirmed by owner | Migration file exists under `db/migrations/`, and owner confirmed production execution. |
| Live Vercel production deployment | Not verified | No `.vercel/project.json` is present, and no Vercel project/team id was available. |

## Production-Readiness Findings

### Cleared: Production schema confirmation

The new dashboard depends on:

- `canvas_projects`
- `canvases.project_id`
- `canvases.manually_archived`
- project accent constraint and related indexes

These are present in `db/migrations/migration_dashboard_projects_archive.sql` and duplicated in `api/lib/db.ts`. The owner confirmed the production database migration was completed.

No further migration action is required for this handoff unless production API calls show schema errors.

### Cleared: Local script cleanup

The tracked SQL migrations were moved to `db/migrations/`. The `scripts/` folder is now ignored for local-only helpers, and the tracked helper scripts were removed from the repo.

If the previous hard-coded database connection string was ever committed, pushed, shared, or exposed outside this local workspace, rotate that database password.

### Medium: Live Vercel production state was not directly verified

This workspace does not include `.vercel/project.json`, so I could not identify the linked Vercel project from local metadata. The available Vercel inspection tool needs a project/team id. Because of that, this report verifies the code and local production build, but not the current production deployment, build logs, or production environment variables.

The owner confirmed environment variables are fine. Remaining optional release check: verify the current Vercel production deployment uses the intended commit.

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- Google/Firebase variables used by auth and the frontend

### Addressed: Project and canvas delete lifecycle

`api/lib/canvas-lifecycle.ts` now owns canvas deletion side effects. Direct canvas deletes and project deletes both route through that lifecycle, so deleted canvases trigger the same local attachment usage recalculation, global usage recalculation, and project ancestor touch behavior.

The dashboard now reloads from production data after successful canvas/project deletes so folder canvas counts, the guild card count, archive count, and section counts are refreshed from the Vercel API instead of optimistic local filtering.

### Low: Lint is currently not a release signal

`npm run lint` fails with existing issues across unrelated files such as `NodeActionOverlay.tsx`, `VoiceMicButton.tsx`, `preview.ts`, and parser/export utilities. Build and tests still pass. This does not block the dashboard handoff by itself, but it means lint cannot currently be used as a clean production gate.

## What Looks Good

- The simulator's core dashboard model made it into production rather than remaining mock-only.
- Production routes use Vercel serverless functions, matching the repo instruction to ignore the old development server.
- The frontend is no longer relying on simulator mock state for projects, movement, archive flags, or canvas assignment.
- The serverless API validates project ownership before assigning canvases or moving projects.
- Project self/descendant moves are blocked server-side, not just in the UI.
- Build and unit tests are green.

## Suggested Go/No-Go

Status: Conditional go.

Go for production only after confirming:

1. The Vercel production deployment is pointed at the updated code.
2. Credentials are rotated if the previous hard-coded DB string was ever exposed outside this local workspace.
3. Run `db/migrations/migration_drop_skill_stars.sql` after the updated code is deployed if production still has the deprecated `skill_notes.stars` column.

The handoff itself is largely complete in code. The remaining cleanup is only applying the optional database migration that removes the deprecated star cache column.
