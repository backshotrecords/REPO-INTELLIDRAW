# Skills Marketplace Install and Update Walkthrough

This document consolidates the current skills marketplace behavior, the product problems it creates, and the proposed direction for a more serious marketplace model.

## Current Behavior

### Skill Library

Today, user-created skills live in `skill_notes`.

A skill row contains:

- owner
- title
- description
- instruction text
- category
- published state
- stars
- version
- optional `source_skill_id`
- optional `source_version`

The same table is used for authored skills, published skills, and installed skills.

### Publishing

Publishing currently behaves like a simple state toggle.

When a user publishes a skill:

- the existing skill row is marked as published
- the skill appears in the marketplace
- there is no immutable published snapshot
- there is no release step
- there are no release notes
- there is no separate "published skill" management area

When the owner edits the skill instruction text, the `version` value increments. That version value is used for update detection, but the old version content is not preserved as a first-class historical snapshot.

### Marketplace Listing

The marketplace currently lists published `skill_notes`.

It includes:

- the skill content
- owner display info
- category
- stars

It does not include:

- whether the current user already installed the skill
- the user's installed copy ID
- whether the user's installed version is stale
- install count
- installed version information

Because of that, the marketplace UI cannot reliably show `Installed`, `Open`, or `Update`.

### Installing

Current install behavior is closer to forking than installing.

When a user installs a marketplace skill:

1. The API loads the published source skill.
2. It inserts a new `skill_notes` row owned by the installing user.
3. The new row copies the source title, description, instruction text, and category.
4. The new row stores:
   - `source_skill_id`
   - `source_version`

This means installed skills become private editable copies in the user's library.

There is no uniqueness rule preventing repeat installs. A user can install the same published skill over and over, creating multiple copied rows.

### Install Feedback

After install:

- the modal closes
- the page reloads data
- no success notification is shown
- the marketplace card still says `Install`
- the user is not clearly told where the installed skill went

### Update Detection

Some update support already exists.

An installed skill can be checked against its source:

- local installed row has `source_skill_id`
- local installed row has `source_version`
- source row has `version`
- if source version is greater than installed source version, an update exists

There is also a sync endpoint that copies the latest source content into the installed copy.

However, this update experience is only surfaced in the canvas skills panel for attached installed skills. It is not shown as a full marketplace or library workflow.

### Canvas Attachments

"Attachment" means a skill is attached to a canvas so that it affects AI behavior.

There are two attachment scopes:

- local/project: attached to one canvas
- global: applies across the user's canvases

The current attachment records point to a `skill_note_id`.

Because installed skills are copied into `skill_notes`, a canvas attachment points to the copied installed row, not to a formal installation record or a specific immutable published version.

## Problems With Current Behavior

### Install Is Really Fork

The app says `Install`, but the system creates an editable private copy.

That creates product confusion:

- users can install the same skill repeatedly
- installed skills look too much like authored skills
- installed skills live in the same library as user-created skills
- ownership is blurred
- updates are copy/sync operations instead of version selection

### Published Skills Are Not Protected

Published skills are currently treated too much like regular private skills.

For a real marketplace, published skills need stronger rules:

- publishing should create immutable released versions
- editing a published skill should prepare a new version, not silently mutate the public artifact
- deleting a published skill should be guarded
- users who installed old versions should not lose access unexpectedly

### No Version History

The app tracks a numeric version, but not historical version content.

If the owner updates the source skill, there is no durable snapshot of the old published content unless it happens to exist as a user's copied installed row.

That is not reliable enough for a marketplace.

### Installed Skill Updates Are Too Coarse

The current system treats "update my installed copy" as the main update event.

But canvas behavior also matters. A canvas is a working artifact, and its AI behavior should not change invisibly just because a library skill was updated.

### Authored, Published, and Installed Skills Need Different UX

The current library mixes several concepts:

- private drafts
- published skills owned by the user
- installed skills from other users

These need separate management surfaces.

## Proposed Product Model

The marketplace should be modeled more like an app store or package registry.

There are four main skill states:

- draft skill
- published skill
- installed skill
- archived or retired published skill

### Draft Skills

Draft skills are private user-authored skills.

They can be:

- created
- edited
- deleted
- attached to canvases
- prepared for publishing

Drafts are casual and flexible.

### Published Skills

Published skills are marketplace artifacts owned by a user.

They should be managed separately from drafts.

A published skill should have:

- a stable source identity
- immutable published versions
- a current/latest published version
- install stats
- active usage stats
- update/release history

Publishing should not just toggle a boolean. It should be a release action.

### Installed Skills

Installing should not create a private editable copy.

Installing should create a user installation/subscription record that points to a published skill and a specific published version.

Installed skills should always be linked to:

- the source published skill
- a pinned installed version

Users should not edit installed skills directly.

If users want a custom editable version, that should be an explicit action such as:

- `Make a copy`
- `Remix`
- `Fork`

That copied skill should then become the user's authored draft, clearly separate from the installed marketplace skill.

### Archived or Retired Skills

Published skills should not be casually hard-deleted once they have installs or version history.

Possible lifecycle actions:

- `Unpublish`: hide from marketplace discovery, but existing installs continue to work
- `Archive`: stop new installs and indicate the skill is retired
- hard delete: only allowed when there are no installs and no meaningful published history

## Proposed Version Model

### Published Versions

When a skill is first published, the app should create the first immutable published version.

Recommended public version numbering:

- initial publish: `v1`
- first update: `v2`
- second update: `v3`

The user mentioned `version zero` as the first publish possibility. That is possible, but `v1` is likely clearer for marketplace users because it matches common release expectations.

Each published version should snapshot:

- title
- description
- instruction text
- category
- release notes
- published timestamp
- author/source skill ID

Once created, a version snapshot should not be mutated.

### Updating Published Skills

For published skills, editing should create or update a pending draft for the next version.

Suggested flow:

1. Owner edits the skill.
2. App indicates there are unpublished changes.
3. Owner clicks `Publish update`.
4. App shows a release confirmation step.
5. Owner enters optional release notes.
6. App creates a new immutable version snapshot.
7. Installers see an update is available.

### Installer Choice

When the owner publishes a new version, users who installed the skill should be able to choose:

- keep their old installed version
- update to the latest version

Installed behavior should never silently change.

This is especially important because skill instructions affect AI behavior. Users need trust and predictability.

## Proposed Canvas Update Model

There should be two levels of update:

1. installed/library-level update
2. canvas attachment-level update

### Library-Level Update

The user has installed a marketplace skill and pinned it to a version.

Example:

- source latest version: `v3`
- user's installed version: `v2`

The Installed Skills area should show:

- `Update available`
- current installed version
- latest available version
- option to update the installed skill to the latest version

Updating here changes what the user's installed skill points to, but should not automatically change existing canvas behavior.

### Canvas-Level Update

A canvas attachment should also be pinned to a version.

Example:

- user's installed skill: `v3`
- canvas attachment: `v2`

The canvas should show that attached skills are stale.

Suggested UX:

- top-level canvas notification: `Attached skills have updates`
- inside the Canvas Skills panel, each stale skill shows an update indicator
- the stale skill row has an action like `Update on this canvas`

This prevents hidden changes to existing canvases.

### Global Skill Attachments

If a skill is attached globally, updating the global attachment should update it everywhere that global attachment applies.

Conceptually:

- one global attachment record
- shared across all relevant canvases for that user
- one update changes all canvases using that global attachment

### Local Project Attachments

If a skill is attached locally/project-based, updating it should happen per canvas.

Conceptually:

- each canvas has its own local attachment record
- updating one local attachment only changes that canvas

### Proposed Update Hierarchy

The update hierarchy should be:

```text
Published source latest version
        ↓
User installation pinned version
        ↓
Canvas/global attachment pinned version
```

This gives users control at both levels:

- whether their installed skill accepts a new source version
- whether each canvas actually starts using that newer installed version

## Proposed UX Surfaces

### My Drafts

Private skills the user authored but has not published.

Actions:

- create
- edit
- delete
- publish
- attach to canvas

### My Published Skills

Marketplace skills owned by the user.

Actions and information:

- view latest published version
- edit next version draft
- publish update
- view release history
- unpublish or archive
- see install count
- see active attachment count
- see stale install count
- see current-version adoption

Published skills should be protected from accidental deletion.

### Installed Skills

Marketplace skills installed from other authors.

Actions and information:

- open/view details
- see author
- see installed version
- see latest available version
- update installed version
- keep old version
- uninstall
- attach to canvas
- optionally make a private copy/remix

### Marketplace

Marketplace cards should reflect the current user's relationship to each skill.

Suggested card states:

- `Install`: user has not installed it
- `Open`: user has installed the latest version
- `Update`: user has installed it, but a newer version exists
- `Manage`: user owns the published skill

The card should not allow repeated installs.

### Canvas Skills Panel

The canvas skills panel should show:

- attached local skills
- attached global skills
- current attached version
- stale/update status
- update action
- whether updating affects only this canvas or all canvases

For global updates, the UI should make scope clear, for example:

```text
Update globally
Applies to all canvases using this global skill.
```

For local updates:

```text
Update on this canvas
Only this canvas will use the newer version.
```

## Proposed Data Model Direction

The exact schema can be refined during implementation, but the important concept is to split authored skills, published versions, installations, and canvas usage.

### `skill_notes`

Represents the author-owned skill identity and draft state.

Possible fields:

- `id`
- `owner_id`
- `status`: `draft`, `published`, `archived`
- `current_published_version_id`
- draft title
- draft description
- draft instruction text
- draft category
- timestamps

### `skill_note_versions`

Represents immutable published snapshots.

Possible fields:

- `id`
- `skill_note_id`
- `version_number`
- `title`
- `description`
- `instruction_text`
- `category`
- `release_notes`
- `published_at`
- `created_by`

### `skill_installations`

Represents a user's installed/subscribed marketplace skill.

Possible fields:

- `id`
- `user_id`
- `skill_note_id`
- `installed_version_id`
- `installed_at`
- `updated_at`
- `status`: `active`, `uninstalled`, `archived`

There should be a uniqueness rule preventing duplicate active installs:

```text
unique active installation per user per published skill
```

### `skill_note_attachments`

Represents skill usage on canvases.

Attachments should be pinned to a version or installation/version pair.

Possible fields:

- `id`
- `user_id`
- `canvas_id`
- `scope`: `local`, `global`
- `trigger_mode`: `automatic`, `manual`
- `skill_installation_id` for installed marketplace skills
- `skill_note_id` for owned draft/private skills, if still supported
- `attached_version_id`
- `is_active`
- timestamps

For clean long-term behavior, the attached version is the important field. It preserves the exact instructions the canvas is using.

## Important Product Rules

1. Installing a marketplace skill should be idempotent.

   Installing the same skill twice should not create two installed skills.

2. Installed skills should not be private editable copies.

   They should stay linked to the source and a pinned version.

3. Published versions should be immutable.

   Once a version is published, its content should not change.

4. Existing canvas behavior should not change silently.

   Updating a library install should not automatically update every local canvas attachment.

5. Global attachments update globally.

   If the user updates a stale global skill attachment, every canvas using that global attachment should now use the newer version.

6. Local attachments update per canvas.

   If the user updates a stale local skill attachment, only that canvas should change.

7. Published skills should be protected.

   They should not be casually deleted once they have published versions or installs.

8. Forking/remixing should be explicit.

   If a user wants to customize an installed marketplace skill, that should be a separate action with clear ownership semantics.

## Migration Considerations

The current database already has:

- `skill_notes`
- `source_skill_id`
- `source_version`
- `skill_note_attachments`

Existing installed skills are private copied rows with `source_skill_id`.

Migration will need to decide how to handle those rows:

1. Convert copied installed rows into `skill_installations`.
2. Create version snapshots for currently published source skills.
3. Attach existing copied installed skills to the closest source version.
4. Preserve any user edits to copied installed skills carefully.

The hardest migration question is user-edited installed copies.

If an installed copied skill was edited after install, it is no longer truly the source version. Options:

- convert it into a private draft/remix
- keep it as an authored skill with source attribution
- ask users to choose during migration, if needed

For a first implementation, it may be acceptable to:

- treat copied installed rows with no edits as installations
- treat edited copied rows as private remixes

## Open Decisions

### First Published Version Number

Options:

- `v0`: matches the user's initial thought
- `v1`: more common user-facing release convention

Recommendation: use `v1` for the first marketplace release.

### Should Library Update Automatically Offer Canvas Updates?

When a user updates an installed skill in their library, the app could immediately show:

```text
3 canvas attachments still use older versions.
```

It could offer:

- update all global attachments
- review local attachments

Recommendation: show this information, but do not automatically update local canvas attachments.

### Should Installed Skills Be Attachments Directly?

One implementation option is:

- installed skills exist in `skill_installations`
- canvas attachments point to `skill_installation_id` and `attached_version_id`

Another is:

- canvas attachments point directly to `skill_note_versions`
- installations are used only for library/marketplace state

Recommendation: attachments should at minimum store `attached_version_id`. That is what guarantees stable canvas behavior.

### What Happens When a Published Skill Is Archived?

Possible rule:

- existing installed versions continue to work
- no new installs
- marketplace card shows archived/retired state if directly opened
- users are warned that no future updates are expected

## Summary

The current marketplace is built around copied skill rows. That was a useful starting point, but it makes install, ownership, update, and canvas behavior ambiguous.

The proposed direction is to treat the marketplace as a real distribution system:

- authors publish immutable versions
- users install source-linked skills pinned to versions
- users choose whether to update installed skills
- canvases remain pinned until explicitly updated
- global attachments update globally
- local attachments update per canvas
- drafts, published skills, and installed skills have separate UX

This model gives users trust, prevents repeated installs, protects published work, and makes skill updates predictable.
