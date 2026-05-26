# Skills Marketplace Implementation Plan

This plan describes the refactor from the current copied-skill marketplace model to a versioned marketplace model with immutable releases, idempotent installs, private sharing, pinned canvas attachments, and explicit user-controlled updates.

## Goals

1. Separate authored skills from installed marketplace skills.
2. Treat published/shared skills as versioned releases, not mutable rows.
3. Make install idempotent.
4. Pin installed skills to immutable published versions.
5. Pin canvas/global attachments to explicit versions.
6. Prevent silent behavior changes on canvases.
7. Add private marketplace behavior for `Shared With Me`.
8. Protect published skills from accidental deletion.
9. Give authors useful stats for published/shared skills.
10. Preserve existing user data through migration.

## Target Product Model

### Main Surfaces

- `My Drafts`: private authored skills that are editable and deletable.
- `My Published Skills`: user-owned released skills with versions, stats, release history, and protected lifecycle actions.
- `Marketplace`: public discoverable released skills.
- `Shared With Me`: private marketplace containing skills shared directly with the user or with groups they belong to.
- `Installed Skills`: skills installed from Marketplace or Shared With Me.
- `Canvas Skills Panel`: local/global canvas attachments pinned to exact versions.

### Core Concepts

- A draft skill is editable.
- A released skill version is immutable.
- An installation points to a released skill and a pinned version.
- A canvas attachment points to an installed skill or owned skill and a pinned attached version.
- Updating a source skill does not automatically update installations.
- Updating an installation does not automatically update canvas attachments.
- Updating a local attachment affects one canvas.
- Updating a global attachment affects all canvases using that global attachment.

## Phase 0: Product Decisions

These choices are currently agreed:

1. First public/shared release is `v1`.
2. Shared skills behave like a private marketplace.
3. Private/shared releases use the same immutable version system as public releases.
4. Installed marketplace/shared skills are not directly editable.
5. Customization is explicit via `Make a copy` or `Remix`.
6. Canvas stale state compares attachment version against the user's installed version.
7. Source stale state compares user's installed version against source latest version.
8. Draft/private owned skill attachments are live references until the skill is released.
9. Sharing requires a release snapshot. Shared skills appear in the recipient's private `Shared With Me` marketplace.
10. Groups control private shared distribution. For example, sharing to a beta testers group makes the released skill visible to that group's members in `Shared With Me`.
11. Uninstall removes the skill from Installed Skills and removes/deactivates its active canvas attachments.
12. After updating an installation, the user should be offered a one-click option to update all stale attachments that use that installation.
13. Archived/deprecated skills are removed from public/shared discovery, but remain visible in the Installed Skills library for users who already installed them.
14. Owners see aggregate install/usage stats only, not the identities of users who installed their skills.

## Phase 1: Database Schema

### 1.1 Add `skill_note_versions`

Create immutable published/shared version snapshots.

Suggested columns:

```sql
CREATE TABLE IF NOT EXISTS skill_note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  instruction_text TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  release_notes TEXT DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'shared')),
  published_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(skill_note_id, version_number)
);
```

Notes:

- `visibility` lives on `skill_notes`.
- Versions inherit the skill's visibility.
- The system should not support different visibility levels for different versions of the same skill.

### 1.2 Add `skill_installations`

Create user install records.

Suggested columns:

```sql
CREATE TABLE IF NOT EXISTS skill_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_note_id UUID NOT NULL REFERENCES skill_notes(id) ON DELETE CASCADE,
  installed_version_id UUID NOT NULL REFERENCES skill_note_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'uninstalled', 'archived')),
  installed_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

Add uniqueness for active installs:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_installations_active_unique
  ON skill_installations(user_id, skill_note_id)
  WHERE status = 'active';
```

### 1.3 Extend `skill_notes`

Add fields for release state.

Suggested migration:

```sql
ALTER TABLE skill_notes
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS current_published_version_id UUID REFERENCES skill_note_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS has_unpublished_changes BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unpublished_at TIMESTAMPTZ;
```

Suggested status values:

- `draft`
- `published`
- `unpublished`
- `archived`

Suggested visibility values:

- `private`
- `shared`
- `public`

### 1.4 Extend `skill_note_attachments`

Pin installed marketplace/shared attachments to exact versions.

Suggested migration:

```sql
ALTER TABLE skill_note_attachments
  ADD COLUMN IF NOT EXISTS skill_installation_id UUID REFERENCES skill_installations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attached_version_id UUID REFERENCES skill_note_versions(id) ON DELETE RESTRICT;
```

Rules:

- Installed marketplace/shared attachments should have `skill_installation_id` and `attached_version_id`.
- Owned draft/private attachments may continue using `skill_note_id`.
- Long term, `attached_version_id` should be the source of truth for released skills.

### 1.5 Rework `skill_note_shares`

Current shares can become access grants to private marketplace listings.

Suggested shape:

```sql
ALTER TABLE skill_note_shares
  ADD COLUMN IF NOT EXISTS access_level TEXT DEFAULT 'install'
  CHECK (access_level IN ('view', 'install'));
```

Existing columns can remain:

- `skill_note_id`
- `shared_by`
- `shared_with_user_id`
- `shared_with_group_id`

Rule:

- Shared skills must have at least one immutable released version before recipients can install.

## Phase 2: Data Migration

### 2.1 Create Version Snapshots for Existing Published Skills

For each existing `skill_notes` row where `is_published = true`:

1. Create `skill_note_versions` row from current skill content.
2. Use existing `version` as `version_number` if clean, or normalize to `v1`.
3. Set `skill_notes.current_published_version_id`.
4. Set `skill_notes.status = 'published'`.
5. Set `skill_notes.visibility = 'public'`.

Recommendation:

- Normalize first release to `v1` unless existing version history is meaningful.

### 2.2 Convert Existing Installed Copies

Existing installs are `skill_notes` rows with `source_skill_id`.

For each copied installed row:

1. Find source skill.
2. Find or create matching source version.
3. Detect whether copied row was edited after install.
4. If not edited, create `skill_installations` record.
5. If edited, preserve it as a private draft/remix.

Edit detection options:

- Compare title, description, instruction text, category with source version content.
- Compare `source_version` against source version.
- Use `updated_at > created_at` as a weak signal only.

### 2.3 Migrate Attachments

For attachments pointing to copied installed rows:

1. Find the corresponding new `skill_installation`.
2. Set `skill_installation_id`.
3. Set `attached_version_id` to the version represented by the old copied skill.
4. Preserve `scope`, `trigger_mode`, and `is_active`.

For attachments pointing to authored/private skills:

- Keep as `skill_note_id`.
- Leave `attached_version_id` null for now.

### 2.4 Preserve Shared Skills

Existing `skill_note_shares` rows should become private marketplace access grants.

For shared skills:

1. Ensure the shared source skill has at least one version snapshot.
2. If not public, set visibility to `shared`.
3. Recipients should see the skill in `Shared With Me`.
4. Recipients still need to install before using as installed marketplace skills.

## Phase 3: API Refactor

### 3.1 Skill Draft APIs

Keep or update:

- `GET /api/skills`
- `POST /api/skills`
- `PUT /api/skills/:id`
- `DELETE /api/skills/:id`

New behavior:

- `GET /api/skills` should return user-authored drafts and possibly authored published skills, depending on UI split.
- Editing a published skill should set `has_unpublished_changes = true`.
- Deleting a published skill should be blocked if it has versions or installs.
- Private draft deletion remains allowed.

Suggested endpoints:

- `GET /api/skills/drafts`
- `GET /api/skills/published`

### 3.2 Publish APIs

Replace simple publish toggle with release creation.

Suggested endpoints:

- `POST /api/skills/:id/publish`
- `POST /api/skills/:id/publish-update`
- `POST /api/skills/:id/unpublish`
- `POST /api/skills/:id/archive`

Publish request body:

```json
{
  "visibility": "public",
  "release_notes": "Initial release"
}
```

Publish update behavior:

1. Verify ownership.
2. Verify title/instructions are valid.
3. Determine next version number.
4. Insert immutable `skill_note_versions` row.
5. Update `current_published_version_id`.
6. Set status/visibility.
7. Clear `has_unpublished_changes`.

### 3.3 Marketplace APIs

Update:

- `GET /api/skills/marketplace`

New response should include relationship state:

```ts
type MarketplaceSkill = {
  id: string;
  latest_version_id: string;
  latest_version_number: number;
  title: string;
  description: string;
  category: string;
  owner_display_name?: string;
  install_count: number;
  active_attachment_count: number;
  relationship: "not_installed" | "installed_current" | "installed_stale" | "owner";
  installation_id?: string;
  installed_version_id?: string;
  installed_version_number?: number;
};
```

Query rules:

- public marketplace shows `status = 'published'` and `visibility = 'public'`
- archived skills should not appear in normal discovery
- owners see `Manage`
- installed users see `Open` or `Update`

### 3.4 Shared With Me APIs

Treat as private marketplace.

Suggested endpoint:

- `GET /api/skills/shared-with-me`

New behavior:

- Return skills shared directly with the user.
- Return skills shared with groups the user belongs to.
- Include the same relationship state as marketplace.
- Only include skills with at least one released version.
- Use same card states: `Install`, `Open`, `Update`.

### 3.5 Installation APIs

Replace copied-row install behavior.

Suggested endpoints:

- `POST /api/skills/:id/install`
- `GET /api/skills/installations`
- `POST /api/skill-installations/:id/update`
- `POST /api/skill-installations/:id/uninstall`
- `POST /api/skill-installations/:id/remix`

Install behavior:

1. Verify source is installable by user:
   - public marketplace access, or
   - direct share access, or
   - group share access.
2. Check for active installation.
3. If active installation exists, return it.
4. If not, create installation pinned to latest released version.
5. Return relationship state and installation.

Update installation behavior:

1. Verify active installation.
2. Find source latest version.
3. Update `installed_version_id`.
4. Do not update attachments.
5. Return stale attachment counts.

Uninstall behavior:

1. Confirm the user understands this removes the skill everywhere they use it.
2. Remove or deactivate active canvas attachments for that installation.
3. Mark installation `uninstalled`.
4. Remove it from Installed Skills.

Remix behavior:

1. Pick installed version or selected version.
2. Insert new private draft into `skill_notes`.
3. Mark it as authored by current user.
4. Do not link it as an installation.

### 3.6 Attachment APIs

Update:

- `GET /api/skills/attachments`
- `POST /api/skills/attachments`
- `PUT /api/skills/attachments/:id`
- `DELETE /api/skills/attachments/:id`

New attach behavior:

For installed marketplace/shared skill:

1. Accept `skill_installation_id`.
2. Set `attached_version_id = installation.installed_version_id`.
3. Store scope and trigger mode.

For owned private/draft skill:

1. Accept `skill_note_id`.
2. Keep current behavior for first pass.

New update attachment behavior:

- `POST /api/skills/attachments/:id/update-version`

Local update:

- update only that attachment's `attached_version_id`

Global update:

- update the user's global attachment record
- all canvases reading global attachments now use the new version

Stale calculation:

- attachment is stale if `attached_version_id !== installation.installed_version_id`
- installation is stale if `installed_version_id !== source.current_published_version_id`

### 3.7 Active Skill Injection APIs

Update AI instruction loading.

Current behavior joins attachments to `skill_notes`.

New behavior:

- If attachment has `attached_version_id`, load instruction text from `skill_note_versions`.
- If attachment only has `skill_note_id`, load instruction text from `skill_notes`.

Affected endpoints likely include:

- `api/chat.ts`
- `api/chat_fix.ts`
- `api/skills/trigger.ts`

## Phase 4: Frontend Refactor

### 4.1 Skills Marketplace Page Structure

Current tabs:

- Marketplace
- Shared With Me
- My Library

Proposed tabs:

- My Drafts
- My Published
- Marketplace
- Shared With Me
- Installed

Mobile labels can be shortened:

- Drafts
- Published
- Market
- Shared
- Installed

### 4.2 My Drafts UI

Show private authored skills.

Actions:

- create new skill
- edit
- delete
- publish
- attach

If draft is linked to a published skill and has unpublished changes:

- show `Unpublished changes`
- show `Publish update`

### 4.3 My Published UI

Show owned published/shared skills.

For each skill show:

- latest version
- visibility: public/shared
- status: published/unpublished/archived
- install count
- active attachment count
- stale install count
- release history

Actions:

- manage
- edit next version
- publish update
- share
- unpublish
- archive
- delete only when safe

### 4.4 Publish Dialog

Replace simple publish toggle with a release dialog.

First publish dialog:

- confirm skill title/description/instructions
- choose visibility:
  - public marketplace
  - private/shared release
- optional release notes
- safety warning that published versions are immutable

Publish update dialog:

- show current latest version
- show new version number
- optional release notes
- explain installers will see update available
- confirm create immutable version

### 4.5 Marketplace Cards

Cards need relationship state.

States:

- `Install`
- `Open`
- `Update`
- `Manage`

Behavior:

- `Install`: creates or returns active installation
- `Open`: opens installed skill details
- `Update`: opens update flow or updates installation after confirmation
- `Manage`: opens My Published management view

Card should show:

- latest version
- author
- install/use stats
- category
- safety/audit affordance before install

### 4.6 Shared With Me UI

Use the same card component as Marketplace.

Differences:

- heading explains private shared skills
- cards may show shared by user/group
- no global discovery/search beyond shared access
- same install/open/update mechanics

### 4.7 Installed Skills UI

Show installed marketplace/shared skills.

For each installed skill show:

- source title
- author
- installed version
- latest version
- current/stale status
- attachment counts
- stale attachment counts

Actions:

- open
- update installed skill
- keep old version
- attach to canvas
- uninstall
- make a copy/remix

After updating an installed skill:

- show success
- show stale attachment counts
- offer to review canvas/global attachments
- offer one-click update for all stale attachments that use that installation

### 4.8 Canvas Skills Panel UI

Show top-level notification when attached skills are stale.

Inside panel:

- show local attachments
- show global attachments
- show attached version
- show installed version if different
- show stale indicator

Actions:

- `Update on this canvas` for local attachments
- `Update globally` for global attachments
- toggle active
- detach/remove
- trigger manual skill

Global update copy should clearly say:

```text
This updates the global skill attachment across your canvases.
```

Local update copy should clearly say:

```text
This updates only this canvas.
```

## Phase 5: Stats

### 5.1 Author Stats

For My Published Skills, calculate:

- active install count
- active attachment count
- local attachment count
- global attachment count
- stale install count
- current version install count

Optional later:

- update adoption rate
- uninstall count
- manual run count
- per-version install trend

### 5.2 Marketplace Stats

Marketplace cards can show:

- install count
- active usage count
- stars, if retained

Current `stars` are derived from attachments. Decide whether to:

- keep stars as active usage proxy
- rename to active usage
- add explicit favorite/star behavior later

Recommendation:

- Do not overload `stars` long term.
- In the code and UI, replace attachment-derived `stars` language with `active usage` or another clearer usage metric.
- Add real favorites/stars later if needed as a separate user action.

## Phase 6: Backward Compatibility

Checklist:

- update `api/skills/*`
- update `src/lib/api.ts`
- update `src/types.ts`
- update skill injection in chat endpoints
- update migration SQL

## Phase 7: Testing Strategy

### 7.1 Unit/API Tests

Add tests for:

- first publish creates version `v1`
- publish update creates next immutable version
- install is idempotent
- public marketplace relationship states
- shared marketplace access through direct share
- shared marketplace access through group membership
- installation update does not update attachments
- local attachment update changes one canvas
- global attachment update changes global record
- hard delete blocked with versions/installs
- archived skills cannot be newly installed

### 7.2 Migration Tests

Test migration cases:

- existing published skill becomes published with version
- existing installed copy becomes installation
- duplicate installed copies are handled safely
- edited installed copy becomes private remix
- existing attachment to installed copy maps to installation/version
- shared skill appears in Shared With Me private marketplace

### 7.3 Frontend Flow Tests

Manual or browser-based tests:

1. Create draft.
2. Publish to public marketplace.
3. Install as another user.
4. Confirm second install returns existing installation.
5. Author publishes update.
6. Installer sees update in Marketplace and Installed Skills.
7. Installer updates installed skill.
8. Canvas attachment remains stale.
9. Local canvas update updates only one canvas.
10. Global update applies across canvases.
11. Share skill with group.
12. Group member sees it in Shared With Me and installs it.

## Phase 8: Implementation Order

### Step 1: Add Schema and Types

- Add migration SQL.
- Update TypeScript types.
- Add API response types for versions, installations, relationships, stats.

### Step 2: Build Version Creation

- Implement first publish and publish update.
- Keep old publish endpoint temporarily or route it to new behavior.
- Add release notes support.

### Step 3: Build Installation Model

- Implement idempotent install.
- Add installed skills list.
- Add installation update/uninstall/remix endpoints.

### Step 4: Update Marketplace and Shared Queries

- Marketplace returns relationship state.
- Shared With Me returns private marketplace cards.
- Include latest version and installation metadata.

### Step 5: Update Frontend Tabs and Cards

- Split My Drafts, My Published, Installed.
- Update Marketplace cards.
- Reuse card logic for Shared With Me.

### Step 6: Update Attachments

- Attach installed skills via installation/version.
- Pin attachment version.
- Add stale calculation.
- Add update local/global actions.

### Step 7: Update AI Skill Injection

- Load instructions from `skill_note_versions` for version-pinned attachments.
- Keep fallback for draft/private `skill_notes`.

### Step 8: Add Published Skill Protection and Stats

- Block unsafe deletion.
- Add unpublish/archive.
- Add author stats.

### Step 9: Data Migration and Cleanup

- Convert existing published skills.
- Convert existing installed copies.
- Migrate attachments.
- Decide fate of old `source_skill_id` and `source_version`.

### Step 10: Verification and Polish

- Run build/lint/tests.
- Verify primary user flows in browser.
- Confirm messaging and safety disclaimers.
- Update walkthrough docs after final implementation decisions.

## Risks and Mitigations

### Risk: Breaking Existing Attached Skills

Mitigation:

- Keep fallback path for old `skill_note_id` attachments.
- Migrate in phases.
- Do not remove old fields until verified.

### Risk: User-Edited Installed Copies

Mitigation:

- Detect edited copies.
- Convert them to private drafts/remixes.
- Preserve content rather than forcing them into source-linked installs.

### Risk: Confusing Update Levels

Mitigation:

- Use clear labels:
  - `Update installed skill`
  - `Update on this canvas`
  - `Update globally`
- Show version numbers.
- Show what scope will change before update.

### Risk: Shared Skills Without Stable Releases

Mitigation:

- Require release snapshot before sharing can be installed.
- Treat Shared With Me as private marketplace, not live draft access.

### Risk: Duplicate Install Records During Migration

Mitigation:

- Use partial unique index.
- Collapse duplicate installs by user/source.
- Preserve extra edited copies as private drafts if content differs.

## Acceptance Criteria

The refactor is successful when:

1. A user cannot repeatedly install the same marketplace/shared skill.
2. Installing a skill creates an installation, not a copied editable skill.
3. Marketplace cards show `Install`, `Open`, `Update`, or `Manage` correctly.
4. Shared With Me behaves like a private marketplace.
5. Published updates create immutable version snapshots.
6. Installers can keep old versions or update.
7. Updating an installed skill does not silently update canvases.
8. Canvas stale attachments are visible.
9. Local attachment updates affect only one canvas.
10. Global attachment updates affect all canvases using that global attachment.
11. Published skills with installs/history cannot be casually deleted.
12. Authors can see basic install and usage stats.
13. Existing skills and attachments survive migration.

## Resolved Decisions

1. Private owned draft attachments are live references until release.
2. Sharing requires a release snapshot. Shared releases appear in the recipient's private marketplace.
3. Uninstall removes/deactivates active canvas attachments for that installed skill.
4. Attachment-derived `stars` should become clearer usage language in code/UI, such as `active usage`.
5. Updating an installation should offer one-click update for all stale attachments using that installation.
6. Archived/deprecated skills leave public/shared discovery but remain visible in Installed Skills for users who already installed them, with a deprecated notice.
7. Owners see aggregate counts only, not installer identities.
8. `visibility` lives on `skill_notes`, not per version.
