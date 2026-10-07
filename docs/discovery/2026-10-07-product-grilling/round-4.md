# Grilling Round 4

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation. This is the last round unless your answers open something new.

---

## Q36 - Site and Project Configuration

You chose a login that asks for site URL and project key (Q26 b). The design leans on PSAPAC-specific field ids: Customer `customfield_14849`, Engagement `customfield_14850`, Sprint `customfield_10600`, Start date `customfield_13808`. The site holds several other fields named "Customer", but the project's create metadata lists only the one on PSAPAC's screens.


| Option                                                                                                                                                                                                                                                               | Rec   | Pick  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) One site and project at a time. On login the app resolves Customer, Engagement, Sprint and Start date by name from the project's create metadata, caches the ids, and lets you override any of them in a settings file. Switching project means logging in again | - [x] | - [x] |
| (b) Hard-code PSAPAC's field ids; the site and project fields exist only so the login screen can be reused                                                                                                                                                           | - [ ] | - [ ] |
| (c) Several projects or sites side by side, with a project switcher                                                                                                                                                                                                  | - [ ] | - [ ] |


**Notes:**

---

## Q37 - Search


| Option                                                                                                                    | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Cmd+K searches loaded issues by key and summary as you type; `jm issue list --search <text>` does the same in the CLI | - [x] | - [x] |
| (b) As (a), plus full-text search of descriptions and comments through Jira's JQL `text ~`                                | - [ ] | - [ ] |
| (c) Raw JQL input as well, for power queries                                                                              | - [ ] | - [ ] |


**Notes:**

---

## Q38 - Out of v1

These stay out of v1 unless you tick them in.


| Item                                        | Rec (include) | Pick (include) |
| ------------------------------------------- | ------------- | -------------- |
| Board (kanban) view                         | [ ]           | [ ]            |
| Sprint create, start and complete           | [ ]           | [ ]            |
| Offline edits                               | [ ]           | [ ]            |
| Undo (Cmd+Z) of the last edit               | [ ]           | - [x]          |
| Desktop notifications for changes by others | [ ]           | [ ]            |
| @mentions in descriptions and comments      | [ ]           | - [ ]          |
| Code signing and auto-update                | [ ]           | [ ]            |
| Issue restriction (security level)          | [ ]           | [ ]            |
| Watchers                                    | [ ]           | [ ]            |
| Issue history (changelog) on the issue page | [ ]           | [ ]            |


**Notes:**