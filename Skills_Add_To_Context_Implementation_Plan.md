# Skills Add to Context Implementation Plan

## Objective

Add a contextual Skills mode that preserves the existing global/local attachment model and the existing automatic/manual behavior, while giving users an `Add to Context` action that inserts a skill's prompt into the Workspace input bar for review and editing before the user sends it.

Production priority: this plan assumes the Vercel serverless API architecture is the source of truth. The deprecated local development server is intentionally out of scope.

## What I Agree With

1. Keeping scope and run behavior separate is the right product shape.
   - Scope answers where the skill applies: `local` canvas or `global`.
   - Run mode answers how the skill is used: automatic, manual, or contextual.

2. `Add to Context` should not call the model by itself.
   - The value of the feature is user review and editing.
   - The model should only receive the prompt after the user manually sends the final input.

3. Existing automatic and manual behavior should remain intact.
   - Automatic skills should continue to be injected by `/api/chat`.
   - Manual skills should continue to run through `/api/skills/trigger`.
   - Contextual skills should be ignored by automatic injection and manual trigger logic unless the user explicitly sends the composed prompt.

4. The feature should use pinned skill content where available.
   - Installed marketplace/shared attachments already support `attached_version_id`.
   - Context insertion should use the same attached version payload shown in the Canvas Skills panel so users do not accidentally insert a newer unapproved version.

## What I Would Change or Clarify

1. I recommend making contextual usage a persisted third `trigger_mode`: `contextual`.
   - This matches the supplied flowchart.
   - It lets a user attach a skill specifically as an `Add to Context` skill.
   - It keeps the Canvas Skills panel model simple: one attachment, one scope, one run mode.

2. I do not recommend treating `Add to Context` as a hidden second action on every manual skill for the first implementation.
   - That would be faster, but it blurs the user's mental model.
   - Users may expect manual skills to run immediately, while contextual skills should only edit the input bar.

3. I recommend no new OpenAI/serverless model endpoint for the first implementation.
   - The `GET /api/skills/attachments` response already includes `skill_note.instruction_text` for both draft and version-pinned attachments.
   - The client can insert that text into `chatInput` without a server round trip.
   - If we later want stricter auditing or formatting controlled server-side, add a dedicated endpoint then.

## Current Codebase Findings

### Data Model

Current schema is in `db/migrations/migration_skills.sql`.

- `skill_note_attachments.scope` already supports `local` and `global`.
- `skill_note_attachments.trigger_mode` currently has a check constraint with only `automatic` and `manual`.
- Attachments can point to either:
  - `skill_note_id` for owned/private/draft skills.
  - `skill_installation_id` plus `attached_version_id` for installed marketplace/shared skills.
- Existing versioning and install tables already exist:
  - `skill_note_versions`
  - `skill_installations`

Impact: contextual mode needs a production database migration to expand the `trigger_mode` constraint to include `contextual`.

### Serverless APIs

Relevant Vercel functions:

- `api/skills/attachments/index.ts`
  - Lists and creates attachments.
  - Accepts `scope` and `trigger_mode`.
  - Enriches version-pinned attachments with `skill_note.instruction_text`.

- `api/chat.ts`
  - Loads active skill instructions where `trigger_mode = automatic`.
  - Injects those instructions into the system prompt for every chat request.

- `api/chat_fix.ts`
  - Also loads only `trigger_mode = automatic`.
  - Automatic skills currently affect syntax-fix calls too.

- `api/skills/trigger.ts`
  - Manual run endpoint.
  - Applies one skill immediately to the current Mermaid code through OpenAI.

Impact: contextual mode should require only validation/schema changes in the attachment APIs. It should not be loaded by `/api/chat`, `/api/chat_fix`, or `/api/skills/trigger`.

### Frontend

Relevant files:

- `src/components/CanvasSkillsPanel.tsx`
  - Shows local/global attachments.
  - Lets users attach skills as `automatic` or `manual`.
  - Shows a play button for manual skills.
  - Currently owns no access to the Workspace input bar state.

- `src/pages/WorkspacePage.tsx`
  - Owns `chatInput`, `setChatInput`, `textareaRef`, and `sendMessage`.
  - Passes `onSkillTriggered` into `CanvasSkillsPanel`.
  - Input bar already appends voice transcript text with this pattern:
    - if text exists, append with a space
    - otherwise insert the new text

- `src/lib/api.ts`
  - Types `apiAttachSkill.trigger_mode` as only `automatic | manual`.
  - Contains `apiTriggerSkill`, `apiGetSkillAttachments`, and `apiAttachSkill`.

- `src/types.ts`
  - Types `SkillNoteAttachment.trigger_mode` as only `automatic | manual`.

Impact: `WorkspacePage` should pass an `onAddSkillToContext` callback to `CanvasSkillsPanel`. The panel should call it for contextual attachments.

## Recommended Product Behavior

### Attach Dialog

Add a third run mode option:

- `Auto`
  - Existing behavior.
  - Injected into every chat prompt for that canvas/scope.

- `Manual`
  - Existing behavior.
  - Shows `Run` action.
  - Sends the skill directly to the agent through `/api/skills/trigger`.

- `Context`
  - New behavior.
  - Shows `Add to Context` action.
  - Inserts the skill prompt into the Workspace input bar.
  - Does not call OpenAI.
  - User must edit/send manually.

### Add to Context Insertion

Recommended inserted format:

```text
Use this skill as context:

Skill: <skill title>
<skill instruction text>
```

Append behavior:

- If the input bar is empty, insert the formatted skill context.
- If the input bar already has text, append two newlines and then the formatted skill context.
- Focus the input bar after insertion.
- Do not send automatically.

### Contextual Attachments and Active State

Recommended behavior:

- Disabled contextual attachments should not show an active `Add to Context` action.
- Re-enable restores the action.
- Contextual attachments should count as active attachments in the Canvas Skills panel only if `is_active = true`.
- Contextual mode should not be counted as automatic prompt injection.

## Implementation Plan

### Phase 1 - Schema and Shared Types

1. Update production migration SQL.
   - Change `skill_note_attachments.trigger_mode` check from `('automatic', 'manual')` to `('automatic', 'manual', 'contextual')`.
   - Use a safe constraint replacement migration:
     - drop the existing trigger mode check constraint if it exists.
     - add the new check constraint.
   - Keep existing rows untouched.

2. Update TypeScript unions.
   - `src/types.ts`
   - `src/lib/api.ts`
   - `src/components/CanvasSkillsPanel.tsx`

Recommended union:

```ts
type SkillTriggerMode = "automatic" | "manual" | "contextual";
```

### Phase 2 - Serverless API Guardrails

1. Update `api/skills/attachments/index.ts`.
   - Validate `trigger_mode` against `automatic`, `manual`, or `contextual`.
   - Preserve existing install/version pinning behavior.
   - No model calls.

2. Confirm `api/chat.ts` and `api/chat_fix.ts` continue querying only `automatic`.
   - This already protects contextual skills from automatic injection.
   - Add a targeted test or code comment only if useful.

3. Keep `api/skills/trigger.ts` manual-only by UI convention.
   - No endpoint change required for contextual mode.
   - The frontend should only show the manual run button for `trigger_mode === "manual"`.

### Phase 3 - Workspace Composer Integration

1. Add an input insertion callback in `WorkspacePage`.
   - Suggested function name: `handleAddSkillToContext`.
   - It should accept `{ title, instructionText }`.
   - It should update `chatInput` by inserting or appending the formatted skill context.
   - It should focus `textareaRef.current`.

2. Pass the callback to `CanvasSkillsPanel`.
   - Add prop: `onAddSkillToContext`.

3. In `CanvasSkillsPanel`, add contextual action handling.
   - Only show `Add to Context` for active contextual attachments.
   - Pull title and instruction text from `att.skill_note`.
   - Use `att.attached_version_id` content when provided, which the API already maps into `att.skill_note`.

### Phase 4 - Canvas Skills Panel UI

1. Add mode labels/icons.
   - `automatic`: Auto
   - `manual`: Manual
   - `contextual`: Context

2. Add the third mode button in the attach dialog.
   - The existing two-column layout will not scale well.
   - Recommended: switch to a 3-option segmented row for mode.

3. Add row action.
   - Manual: play icon with title `Run Skill`.
   - Contextual: add/comment icon with title `Add to Context`.
   - Automatic: no action beyond enable/disable/remove.

4. Consider a small visual confirmation.
   - Example: flash the input bar or show a brief `Added to input` state in the row.
   - Do not use a blocking alert.

### Phase 5 - Verification

Production-focused checks:

1. `npm run build`
   - Confirms TypeScript and Vite production build.

2. API/schema review for Vercel functions.
   - Confirm no dependency on `server.dev.mjs`.
   - Confirm no new local-only route is introduced.

3. Manual production-like flow after deployment.
   - Attach contextual local skill.
   - Click `Add to Context` with empty input.
   - Confirm prompt appears and is editable.
   - Type extra text, click `Add to Context` again.
   - Confirm prompt appends rather than replaces.
   - Send manually.
   - Confirm `/api/chat` receives only the final user-edited text plus any automatic skills.
   - Confirm contextual skill is not injected twice.
   - Repeat with a global contextual skill.
   - Repeat with an installed version-pinned skill.

## Approval Decisions Needed

1. Should contextual behavior be a persisted third run mode?
   - Recommendation: yes, add `trigger_mode = contextual`.
   - Alternative: keep DB unchanged and add `Add to Context` as an extra action on manual skills only.

2. Should `Add to Context` be available only for contextual attachments, or for every attached skill?
   - Recommendation: only contextual attachments in the first release.
   - Alternative: show it as a secondary action for all modes.

3. What exact inserted text format should be used?
   - Recommendation:
     ```text
     Use this skill as context:

     Skill: <title>
     <instruction_text>
     ```
   - Alternative: insert only raw `instruction_text`.

4. Should contextual attachments be active/inactive like other modes?
   - Recommendation: yes. Disabled contextual attachments should hide or disable `Add to Context`.

5. Should contextual prompts be saved in chat history before send?
   - Recommendation: no. Only the final manually sent prompt should become chat history.

6. Should contextual skills be allowed globally?
   - Recommendation: yes. Global contextual skills should appear across canvases, but still require the user to click `Add to Context`.

## Risks and Mitigations

### Risk: Double Injection

If a user has the same skill attached as automatic and contextual, they could insert the contextual prompt and also have the automatic version injected by `/api/chat`.

Mitigation:

- Allow it for now because it is explicit.
- Optionally show duplicate-title warnings later.

### Risk: Schema Constraint Failure In Production

The current migration uses a check constraint for `trigger_mode`, so adding a new value without updating Supabase first will break attachment creation.

Mitigation:

- Deploy database migration before frontend/API behavior that sends `contextual`.
- Include a rollback plan that reverts contextual attachments or maps them to manual before restoring the old constraint.

### Risk: Prompt Length Growth

Users can append multiple skills into the input bar and send a very large prompt.

Mitigation:

- Keep first release simple.
- Later add token/character warning in the input bar if needed.

### Risk: Confusing Manual vs Contextual

Manual means "run now"; contextual means "insert and edit."

Mitigation:

- Use distinct labels and tooltips.
- Do not show a play icon for contextual mode.

## Acceptance Criteria

1. Users can attach a skill as local/contextual.
2. Users can attach a skill as global/contextual.
3. Contextual attachments are persisted through Vercel serverless APIs.
4. `Add to Context` inserts the pinned skill prompt into the Workspace input bar.
5. Existing input text is preserved and the skill prompt is appended.
6. Empty input receives only the formatted skill context.
7. The input bar is focused after insertion.
8. No OpenAI request happens when clicking `Add to Context`.
9. The user can edit before sending.
10. Sending uses the normal `/api/chat` path.
11. Automatic skills still inject as before.
12. Manual skills still run as before.
13. Contextual skills are not automatically injected by `/api/chat` or `/api/chat_fix`.
14. Installed skill attachments use the pinned `attached_version_id` content.
15. `npm run build` passes.

## Suggested Implementation Order

1. Update database migration and TypeScript trigger mode types.
2. Update attachment API validation and request types.
3. Add Workspace input insertion callback.
4. Update Canvas Skills panel add dialog and row actions.
5. Run `npm run build`.
6. Deploy DB migration before deploying frontend/API code that emits `contextual`.
