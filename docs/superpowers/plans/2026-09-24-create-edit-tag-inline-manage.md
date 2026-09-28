# Create/Edit Tag Inline Manage Implementation Plan

**Goal:** Notion-style create/rename/delete inside create & edit tag dropdowns only; hide `#manTagBtn`.

**Spec:** `docs/superpowers/specs/2026-09-24-create-edit-tag-inline-manage-design.md`

**Status:** Done (2026-09-24)

## Done

- [x] `tags-ui.js`: `afterTagMutation` + `setEditTagRedraw`; hide `#manTagBtn`
- [x] `ui.js`: `drawManageableTagOptions` / `renderManageableTagFilter`
- [x] `create.js` / `detail.js`: manage wiring, rename commit-before-close, confirm ignore outside-click
- [x] CSS for actions + create-row; empty copy updated

## Manual check

1. Zero tags → open create dropdown → type → create → selected
2. Hover rename / delete with confirm
3. List filter unchanged (no manage)
4. manTagBtn hidden
