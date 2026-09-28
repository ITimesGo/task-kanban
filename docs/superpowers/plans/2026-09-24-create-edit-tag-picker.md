# Create/Edit Tag Picker Implementation Plan

**Goal:** Replace create/edit tag pill walls with searchable multi-select dropdowns (chips + ×), reusing list-filter drawing helpers without changing list filter behavior.

**Spec:** `docs/superpowers/specs/2026-09-24-create-edit-tag-picker-design.md`

**Status:** Done (2026-09-24)

## Done

- [x] `ui.js`: `renderTagSelectedRemovable`; list keeps `renderTagSelected`
- [x] `index.html`: `#createTagWrap` multi-select markup
- [x] `create.js`: searchable dropdown + removable chips + outside-click close
- [x] `detail.js`: same for edit; remove doc listener on cancel/save
- [x] `state.js`: removed `newTagExpanded`
- [x] `styles.css`: createSide / createPanel overflow visible; upward dropdown; `.ms-tag-x`

## Manual check

1. Create: open dropdown, search, check/uncheck, × chip, outside close
2. Edit: same; cancel/save leave no leftover click listener
3. List `#tagFilter*`: still +N chips, clear, filter — unchanged
