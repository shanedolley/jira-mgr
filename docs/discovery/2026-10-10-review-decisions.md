# 2026-10-10 Review Decisions

Shane reviewed the [UX review](2026-10-10-ux-review.md) (#119) and the [Linear gap analysis](2026-10-10-linear-gap-analysis.md) (#120) on the review page on 2026-10-10. The mockups sit in [2026-10-10-ux-review/mockups/](2026-10-10-ux-review/mockups/), and `manifest.json` there holds the CSS each one injected. Mockups use fake data only.

## Design Choices

| Choice | Decision | Before | After |
|---|---|---|---|
| 1 Issue page type scale | B: title 24/600/32, body 14/22, 40rem column, 13/600 section headings, rules between sections | [before](2026-10-10-ux-review/mockups/01-page-type-scale-before.png) | [B](2026-10-10-ux-review/mockups/01-page-type-scale-after-optB.png) |
| 2 Button chrome | Approved. Bin icons replace deletion "x" icons, and a bin turns red on hover | [before](2026-10-10-ux-review/mockups/02-button-chrome-before.png) | [after](2026-10-10-ux-review/mockups/02-button-chrome-after.png) |
| 3 Tree rows | A: rows 32, group headers 36 with an 8px gap. The row anatomy is approved through UX story 11 | [before](2026-10-10-ux-review/mockups/03-tree-rows-before.png) | [A](2026-10-10-ux-review/mockups/03-tree-rows-after-optA.png), [anatomy](2026-10-10-ux-review/mockups/03-tree-rows-after-optA-anatomy.png) |
| 4 Type and status colour | Approved as drawn: type icons grey except Bug, which keeps its red, and each shows its current type colour on hover | [dark](2026-10-10-ux-review/mockups/04-type-status-before.png), [light](2026-10-10-ux-review/mockups/04-type-status-before-light.png) | [dark](2026-10-10-ux-review/mockups/04-type-status-after.png), [light](2026-10-10-ux-review/mockups/04-type-status-after-light.png) |
| 5 Focus and selection | Approved without any border highlight: no left accent bar and no coloured edge on a focused or selected row | [dark](2026-10-10-ux-review/mockups/05-focus-selection-before.png), [light](2026-10-10-ux-review/mockups/05-focus-selection-before-light.png) | [dark](2026-10-10-ux-review/mockups/05-focus-selection-after.png), [light](2026-10-10-ux-review/mockups/05-focus-selection-after-light.png) |
| 6 Properties sidebar | Approved | [Peek](2026-10-10-ux-review/mockups/06-properties-peek-before.png), [page](2026-10-10-ux-review/mockups/06-properties-page-before.png) | [Peek](2026-10-10-ux-review/mockups/06-properties-peek-after.png), [page](2026-10-10-ux-review/mockups/06-properties-page-after.png) |
| 7 Create dialog | B: chip strip. Type is an icon-only dropdown left of the summary, the parent is a searchable field by issue key, and the assignee picker offers "+me" | [before](2026-10-10-ux-review/mockups/07-create-dialog-before.png) | [B](2026-10-10-ux-review/mockups/07-create-dialog-after-optB.png) |
| 8 Toast | Approved, success and refused edit | [success](2026-10-10-ux-review/mockups/08-toast-before.png), [refused](2026-10-10-ux-review/mockups/08-toast-refused-before.png) | [success](2026-10-10-ux-review/mockups/08-toast-after.png), [refused](2026-10-10-ux-review/mockups/08-toast-refused-after.png) |
| 9 Narrow layout at 1024x700 | A: overlay Peek card and icon rail, with no side border highlight anywhere | [before](2026-10-10-ux-review/mockups/09-narrow-1024-before.png) | [A](2026-10-10-ux-review/mockups/09-narrow-1024-after-optA.png) |
| 10 Pending edit | Approved | [before](2026-10-10-ux-review/mockups/10-pending-edit-before.png) | [after](2026-10-10-ux-review/mockups/10-pending-edit-after.png) |
| 11 Empty state | Approved | [before](2026-10-10-ux-review/mockups/11-empty-state-before.png) | [after](2026-10-10-ux-review/mockups/11-empty-state-after.png) |
| 12 Login | Approved | [dark](2026-10-10-ux-review/mockups/12-login-before.png), [light](2026-10-10-ux-review/mockups/12-login-before-light.png) | [dark](2026-10-10-ux-review/mockups/12-login-after.png), [light](2026-10-10-ux-review/mockups/12-login-after-light.png) |

Mockups 5 and 9 still draw a coloured edge or accent bar. Shane's note overrides the picture: build them with fill and weight only.

With no accent bar, selection relies on its fill alone. The builder measures the selected fill against the row background and reports the ratio (WCAG 1.4.11, finding UX12/A5). If it stays under 3:1, Shane picks the next step.

## Stories

| Source | Build | Later | Undecided |
|---|---|---|---|
| UX review | All 14 | none | none |
| Gap analysis | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15 | 14 Activity feed | 13 Favourites and recents (not filed) |

Consolidation, into 26 issues:

- UX story 11 Row anatomy and gap story 2 Row properties and ordering become one issue.
- The description in the Peek, from gap story 10, moves into UX story 6 Properties sidebar.

## Open Questions

| Question | Answer |
|---|---|
| Q1 Do the bulk endpoints accept the team-managed PSAPAC project? | Shane did not know; research answered it with read-only GETs on PSAPAC-3139 and PSAPAC-3134 (2026-10-10). `GET /rest/api/3/bulk/issues/fields` and `/bulk/issues/transition` return 200 for PSAPAC issues. Bulk-editable: Assignee, Labels, Priority, Customer, Engagement (both required), Start date, Due date. Not offered: Sprint and Parent. Status goes only through bulk transition (common transitions Hold, To Do, In Progress, Review, Done). A real POST is unproven. Gap story 4 uses the bulk endpoints for those fields and falls back to one edit per issue for the rest, and a Shane-present bulk POST on a throwaway issue comes before it relies on the bulk path. |
| Q2 Does JQL `watcher = currentUser()` work on PSAPAC? | Yes. Inbox (gap story 15) needs no live check first. |
| Q3 Can sprint progress derive from the changelog alone? | Unanswered. It affects only a Later row. |
| Q4 How does PSAPAC use "PS TEMPLATES"? | It does not. Project templates move from Later to Skip. |
