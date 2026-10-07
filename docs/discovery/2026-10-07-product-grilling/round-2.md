# Grilling Round 2

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation. These questions depend on PSAPAC's metadata, not on your round 1 answers, so you can answer both rounds together.

## PSAPAC Facts


| Fact                                  | Value                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project style                         | Team-managed (next-gen), one board (id 1706, "simple" type)                                                                                                 |
| Issue types                           | Epic, Story, Task, Bug, Subtask                                                                                                                             |
| Volume                                | 2793 issues: 764 unresolved, 2029 Done                                                                                                                      |
| Parents                               | Story, Task and Bug sit under an Epic; Subtask sits under a Story. Only 9 Stories have no Epic                                                              |
| Customer (`customfield_14849`)        | Single select, 42 options, set on every issue at every level                                                                                                |
| Engagement (`customfield_14850`)      | Single select, 21 options, independent of Customer                                                                                                          |
| Customer mismatch                     | 76 Stories (about 3%) carry a different Customer from their Epic                                                                                            |
| Jira-required Customer and Engagement | Epic, Story and Subtask only. Task and Bug do not require them                                                                                              |
| Statuses                              | Hold, To Do, In Progress, Review, Done, plus Opportunity on Epics. Every status reaches every other, with no transition screens                             |
| Link types                            | 21, including tool-owned ones (Polaris x3, Zephyr, migration_parent)                                                                                        |
| Sprints                               | Field `customfield_10600`. 70 sprints: 1 active, 20 or so future, some undated ("PS TEMPLATES", "PS Sprint 88-99"). Epics and Subtasks have no Sprint field |
| Time tracking                         | `timetracking` (original and remaining estimate) on Task, Bug, Story and Subtask. Story also has a separate number field "Time remaining (h)"               |
| Start date                            | `customfield_13808`                                                                                                                                         |
| Assignable users                      | 1232, so the assignee picker has to search rather than preload                                                                                              |
| Permissions                           | You hold every permission needed, including delete, sprint management and worklog edit                                                                      |
| Attachments                           | Enabled, 100 MB limit                                                                                                                                       |


---

## Q14 - Customer and Engagement Enforcement

You said both fields are mandatory on create. Jira enforces that only on Epic, Story and Subtask.


| Option                                                                | Rec   | Pick  |
| --------------------------------------------------------------------- | ----- | ----- |
| (a) The app and CLI require both on every type, Task and Bug included | - [x] | - [x] |
| (b) Follow Jira: required only where Jira requires them               | - [ ] | - [ ] |


Why (a): every existing issue already has both, so the data stays consistent.

**Notes:**

---

## Q15 - Grouping When Customers Disagree

Every issue carries its own Customer, and 76 Stories disagree with their Epic. Where does such a Story appear in the Customer -&gt; Epic -&gt; Story tree?


| Option                                                                                                                | Rec   | Pick  |
| --------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Under its Epic, grouped by the Epic's Customer, with a mismatch badge and a one-click "match Epic's Customer" fix | - [x] | - [x] |
| (b) By its own Customer, so one Epic can appear under two Customers                                                   | - [ ] | - [ ] |
| (c) Under its Epic with no indicator                                                                                  | - [ ] | - [ ] |


**Notes:**

---

## Q16 - Defaults From the Parent

When you create a child issue, or move an issue to a new parent, should Customer and Engagement follow the parent?


| Option                                                                                                                                                      | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) On create, prefill both from the parent (editable). On a parent change where the values differ, ask "Also set Customer/Engagement to the new parent's?" | - [x] | - [x] |
| (b) Prefill on create only. A parent change never touches them                                                                                              | - [ ] | - [ ] |
| (c) Never prefill                                                                                                                                           | - [ ] | - [ ] |


**Notes:**

---

## Q17 - Issues Without an Epic

Nine Stories have no Epic.


| Option                                                    | Rec   | Pick  |
| --------------------------------------------------------- | ----- | ----- |
| (a) A "No Epic" group under each Customer                 | - [x] | - [x] |
| (b) One top-level "Unparented" group across all Customers | - [ ] | - [ ] |


**Notes:**

---

## Q18 - Customer Groups to Show

Some of the 42 Customers will have no open work, and two are internal ("Collibra (Internal team)", "Collibra (Internal template)").


| Option                                                                                                     | Rec   | Pick  |
| ---------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Hide Customers with no issues in the current filter; sort alphabetically; internal Customers sort last | - [x] | - [ ] |
| (b) Always show all 42                                                                                     | - [ ] | - [ ] |
| (c) Sort by open-issue count                                                                               | - [ ] | - [ ] |


**Notes: Have a toggle to hide/show customers with no issues.**

---

## Q19 - Link Type Picker

You asked for every relation type. Five of the 21 belong to other tools (Polaris x3, Zephyr Capture testing, migration_parent).


| Option                                                                                         | Rec   | Pick  |
| ---------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Show all 21: Blocks, Relates, Duplicate, Causes and Clones first, the rest below a divider | - [x] | - [x] |
| (b) Show all 21 alphabetically                                                                 | - [ ] | - [ ] |
| (c) Hide the five tool-owned types                                                             | - [ ] | - [ ] |


**Notes:**

---

## Q20 - Sprint Picker


| Option                                                                                                                                                                 | Rec   | Pick  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Show the active sprint and dated future sprints; closed and undated sprints sit behind "Show all". The field is hidden on Epics and Subtasks, which have no sprint | - [x] | - [x] |
| (b) Show every one of the 70 sprints                                                                                                                                   | - [ ] | - [ ] |


**Notes:** 

---

## Q21 - Status Order and Display

Statuses appear as Linear-style icons, and status changes go straight through, since no transition asks for fields.


| Option                                                                                                            | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Order: Opportunity, To Do, In Progress, Review, Hold, Done. Hold uses a paused icon, Review a half-filled one | - [x] | - [x] |
| (b) A different order (notes)                                                                                     | - [ ] | - [ ] |


**Notes:**

---

## Q22 - Extra Fields

Your list leaves out several fields PSAPAC uses. Tick each one you want visible and editable.


| Field                                                                    | Rec   | Pick  |
| ------------------------------------------------------------------------ | ----- | ----- |
| Priority                                                                 | - [x] | - [ ] |
| Story point estimate (`customfield_13809`)                               | - [ ] | - [ ] |
| Remaining estimate (from `timetracking`, shown beside original estimate) | - [x] | - [ ] |
| Time remaining (h) (`customfield_21785`, Story only)                     | - [ ] | - [x] |
| Flagged                                                                  | - [ ] | - [ ] |
| Fix versions                                                             | - [ ] | - [ ] |
| Team, Partner, Contacts                                                  | - [ ] | - [ ] |
| Reporter                                                                 | - [ ] | - [ ] |


**Notes:**

---

## Q23 - Changing Issue Type

"Create, edit, delete issues of all types" may or may not include converting one type to another.


| Option                                                                                               | Rec   | Pick  |
| ---------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Allow changes between Story, Task and Bug (same level), if Jira's API accepts it on this project | - [x] | - [x] |
| (b) No type changes in v1                                                                            | - [ ] | - [ ] |
| (c) Any type change, including to and from Epic and Subtask                                          | - [ ] | - [ ] |


**Notes:**

---

## Q24 - Assignee Picker


| Option                                                                                      | Rec   | Pick  |
| ------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) "Me" and your recent assignees at the top, then a type-ahead search of assignable users | - [x] | - [x] |
| (b) Type-ahead search only                                                                  | - [ ] | - [ ] |


**Notes:**