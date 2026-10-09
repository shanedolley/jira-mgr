# Linear UI Reference

Screenshots of Linear's web app (workspace `shane-dolley`) at 1440x900, device scale 1, dark theme unless noted. Captured read-only. The screenshots show real workspace data: keep this folder in the private repository.

## Index

| File | Shows | Match |
|---|---|---|
| [00-inbox.png](00-inbox.png) | Sidebar, Inbox list, "No notification selected" empty pane | Sidebar 244px wide, nav rows 28px high with 8px radius, section labels in grey with a disclosure arrow. Inbox rows: 40px avatar, two-line title and subtitle, age right-aligned |
| [01-team-home.png](01-team-home.png) | Team overview page | Tab pills under the header: 28px high, fully rounded, 12px text |
| [02-my-issues.png](02-my-issues.png) | My issues, Assigned tab, mixed priorities, labels, sub-issues nested with a tree line | Row order: priority icon, ID, status icon, title, chips, assignee, date. Urgent shows as an orange square with "!" |
| [03-team-issues.png](03-team-issues.png) | Team All issues, grouped by status, sub-issues nested under the parent | Group header 36px high on a slightly lighter band, count in grey, "+" at the right |
| [04-team-active-grouped.png](04-team-active-grouped.png) | Active tab: In Review, In Progress, Todo groups | A parent in another group repeats dimmed above its children, with a progress ring (6/20). Blocked-by and blocking badges are red pills with a count |
| [05-team-backlog.png](05-team-backlog.png) | Backlog group, 51 rows | Dashed status circle for Backlog. Label chips (Bug, Collibra) sit left of the project chip |
| [06-projects-list.png](06-projects-list.png) | Projects table with columns | Column headers in grey 13px, row 48px, health, lead avatar, percentage with a sparkline |
| [07-team-active-small.png](07-team-active-small.png) | Short list in a small team | List ends cleanly with no footer; the unassigned avatar is a dotted person icon |
| [08-empty-state-views.png](08-empty-state-views.png) | Empty state (Views) | Centred illustration, bold title, grey paragraph, one primary button and one ghost button |
| [09-cycle-detail.png](09-cycle-detail.png) | Cycle page with right-hand panel and burndown | Panel with progress chart and Assignees, Labels, Priority tabs |
| [10-views-list.png](10-views-list.png) | Saved views, grouped Personal and Workspace | Group labels in grey, owner column right-aligned |
| [11-issue-page.png](11-issue-page.png) | Issue page: header breadcrumb, title, sub-issue-of line, description, sub-issues list, activity, properties sidebar | Title 24px 600. Two columns: content about 640px, properties column about 330px starting at x=1001. Sub-issue rows 36px |
| [12-issue-activity.png](12-issue-activity.png) | Activity feed and comment box, scrolled | Activity items are one line, 13px grey, avatar or event icon at the left, time after a dot. Comment box has a paperclip and a round submit button |
| [13-issue-page-rich.png](13-issue-page-rich.png) | Long markdown description (headings, bullets, inline code) | Body 15px, line height 24px. Inline code in a monospace chip |
| [14-issue-comments.png](14-issue-comments.png) | Sub-issues with a cycle chip and activity | Cycle chip with a play icon; status icons green for In Review |
| [15-picker-status.png](15-picker-status.png) | Status picker | Popover about 208px wide, search field with shortcut key at the right, rows 32px, checkmark on current value, number shortcuts 0-9 |
| [16-picker-priority.png](16-picker-priority.png) | Priority picker | Same popover. No priority, Urgent, High, Medium, Low with shortcuts 0-4 |
| [17-picker-assignee.png](17-picker-assignee.png) | Assignee picker | Avatar per row, "Invite and assign" footer |
| [18-picker-estimate.png](18-picker-estimate.png) | Estimate picker | T-shirt scale, triangle icon |
| [19-picker-label.png](19-picker-label.png) | Label picker | Sections: Suggestions, Frequently used, Team labels, Workspace labels. Coloured dot per label |
| [20-picker-project.png](20-picker-project.png) | Project picker | Grouped by team, "Create new project" footer |
| [21-command-palette.png](21-command-palette.png) | Cmd+K palette with an issue in context | The context issue shows as a chip above the input. Rows 46px, shortcut keys in boxed keycaps |
| [22-create-issue-dialog.png](22-create-issue-dialog.png) | Create issue dialog (closed with Esc, nothing submitted) | Title 16px placeholder, description below, property chips in one row, "Create more" toggle, indigo primary button |
| [23-filter-menu.png](23-filter-menu.png) | Filter menu | Search field, "AI filter" and "Advanced filter" first, then fields with a chevron |
| [24-display-options.png](24-display-options.png) | Display options popover | List/Board segmented toggle, Grouping, Sub-grouping, Ordering, toggles, display property chips |
| [25-row-hover.png](25-row-hover.png) | Row hover | Checkbox appears at the left edge; badge tooltip |
| [26-row-keyboard-focus.png](26-row-keyboard-focus.png) | Keyboard-focused row | Row fills lighter with a 1px indigo-grey top and bottom edge, 8px radius, checkbox visible |
| [27-row-selected.png](27-row-selected.png) | Selected row and bulk bar | Row fills indigo tint; a floating bar at the bottom reads "1 selected", "Move to Backlog", "Actions" |
| [28-issue-peek.png](28-issue-peek.png) | Issue peek card over the list (Space on a row) | Card 417px wide, 12px radius, 1px border, large soft shadow, fades out at the bottom |
| [29-light-team-active.png](29-light-team-active.png) | Light theme, team home | Light theme follows `prefers-color-scheme` |
| [30-light-issue-page.png](30-light-issue-page.png) | Light theme issue page | Same layout, white content panel on a grey frame |
| [31-closeup-list-row.png](31-closeup-list-row.png) | 2x crop of two list rows | Tree line, priority bars, ID, status circle, badges, project chip, assignee, date |
| [32-closeup-properties-sidebar.png](32-closeup-properties-sidebar.png) | 2x crop of the properties sidebar | Label 13px grey, value 13px 500 near white, 32px between rows, icon 16px |

## Tokens

Measured with `getComputedStyle` on the live page. Linear defines colours in `lch()`; sRGB values come from screenshot pixels.

### Type

| Item | Value |
|---|---|
| Family | "Inter Variable", "SF Pro Display", -apple-system, system-ui, sans-serif |
| Monospace | "Berkeley Mono", "SFMono Regular", Consolas, Menlo |
| Root scale | small 13px, regular 15px, large 18px |
| List row title | 13px, weight 500, near white |
| List row ID | 13px, weight 450, grey `lch(61.8 1.2 272)` |
| List row chips and date | 12px, weight 450, grey |
| Header breadcrumb | 13px, weight 500, `lch(90.5 1.2 272)` |
| Tab pill | 12px, weight 500, grey, height 28px, padding 0 10px, radius 9999px |
| Issue title | 24px, weight 600, line height 32px, letter spacing -0.16px |
| Description | 15px, weight 450, line height 24px, letter spacing -0.1px, `lch(90.5 1.2 272)` |
| Section heading (Activity) | 15px, weight 600, line height 23px |
| Sub-issues label | 12px, weight 500, grey |
| Properties label and values | 13px, weight 500 |

### Size and Space

| Item | Value |
|---|---|
| Sidebar | 244px wide |
| Nav item | 28px high, 8px radius, 12px from the sidebar edge |
| Main panel | starts at x=244, y=8; 12px radius, 1px border, 0.5px 1px shadow |
| List row | 44px high (sub-issue rows too) |
| Group header | 36px high, 8px radius |
| Chip | 24px high, fully rounded, 1px border |
| Icons | 14px in rows, 16px for status and nav, 18px in the header |
| Avatars | 18px circle in lists, 20px with 8px radius for workspace and team, 40px in Inbox |
| Peek card | 417px wide, 12px radius |

### Colour (dark)

| Item | Value |
|---|---|
| Window frame | `lch(2.6 0.4 272)`, about `#0b0b0c` |
| Main panel and rows | `lch(5.5 0.4 272)`, about `#121213` |
| Secondary surface | `lch(7.3 0.85 272)`; tertiary `lch(8.2 1.3 272)` |
| Panel border | `lch(9.8 1.5 272)`; stronger border `lch(14.2 1.5 272)` |
| Primary text | `lch(100 0 272)`; secondary `lch(90.5 1.2 272)`; tertiary `lch(61.8 1.2 272)` |
| Sidebar hover | `lch(8.4 1.3 272)` |
| Sidebar active | `lch(13.8 1.3 272)` |
| Group header band | about `#1b1b1c` |
| Row focus | fill about `#1a1a1b`, edge about `#2c2e4a` |
| Row selected | fill about `#242647`, edge about `#373a66` |
| Peek and popover | fill `lch(9.2 0.85 272)`, border `lch(17.9 1.9 272)`, shadows `0 4px 40px`, `0 3px 20px` |
| Accent | about `#5e6ad2` (indigo): primary button, Done icon, selected row |
| Blocked badge | salmon red `#e1827b`, on a dark chip |

## Gaps

- Board view: switching layout changes a saved view setting, so it was not toggled. The List/Board control appears in 24-display-options.png.
- Ungrouped list: changing Grouping is a saved setting. 02-my-issues.png is the closest, with no group headers.
- Comments and attachments: no issue in the workspace has either. The empty comment box is in 12-issue-activity.png.
- Toasts: none appeared on their own.
- Light theme: only 29 and 30. Other screens follow the same tokens inverted.
- Hover fill for list rows: Linear paints it on a layer under the pointer, so no computed value was read. Treat hover as the focus fill without the edge.
- Peek: the card cut off at the bottom is how Linear shows long descriptions.
