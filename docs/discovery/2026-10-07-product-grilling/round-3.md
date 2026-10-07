# Grilling Round 3

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation. Your round 1 and 2 answers raised these follow-ups.

---

## Q25 - App and CLI Architecture (Unanswered Q2)

Q2 had no pick.


| Option                                                                                                                                                             | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| (a) One TypeScript repo with a shared `core` module (Jira client, domain rules). The Electron main process and the CLI both import it and each calls Jira directly | - [x] | - [x] |
| (b) The CLI talks to the running app over a local socket                                                                                                           | - [ ] | - [ ] |
| (c) Two separate codebases                                                                                                                                         | - [ ] | - [ ] |


**Notes:**

---

## Q26 - Where the Token Lives

You chose a login screen and a separate token (Q1 b). Electron's `safeStorage` only decrypts inside Electron, so the CLI could not read a token stored there.


| Option                                                                                                                                                                                                                        | Rec   | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) The app's login screen and `jm auth login` both write one macOS Keychain item of the app's own (`jira-mgr`), and both read it. Login asks for email and API token; the site and project stay fixed at Collibra and PSAPAC | - [x] | - [ ] |
| (b) As (a), but login also asks for the site URL and project key                                                                                                                                                              | - [ ] | - [x] |
| (c) The app uses `safeStorage`; the CLI reads a `JIRA_MGR_TOKEN` env var you set yourself                                                                                                                                     | - [ ] | - [ ] |


**Notes:**

---

## Q27 - Done Items in the Tree

Your Q6 note: "If a parent is not yet done, child items at the done status should be hidden." I read that as a Linear-style rule that runs regardless of the "Hide done" toggle.


| Option                                                                                                                                                                         | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| (a) Under an open parent, Done children always hide behind an "N done" chip on the parent that reveals them. "Hide done" separately hides Done parents and their whole subtree | - [x] | - [x] |
| (b) Done children of an open parent hide only while "Hide done" is on                                                                                                          | - [ ] | - [ ] |
| (c) Something else (notes)                                                                                                                                                     | - [ ] | - [ ] |


**Notes:**

---

## Q28 - Toggle Defaults


| Option                                                                                                                                | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) On first launch: "Hide done" on, "Assignee: me" off, empty Customers hidden. Each toggle remembers its last state across launches | - [x] | - [x] |
| (b) Every toggle off on every launch                                                                                                  | - [ ] | - [ ] |
| (c) Different defaults (notes)                                                                                                        | - [ ] | - [ ] |


**Notes:**

---

## Q29 - Customer Order

Q18 had no pick, only the note asking for an empty-Customer toggle, which Q28 covers.


| Option                                                                                                 | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------ | ----- | ----- |
| (a) Alphabetical, internal Customers ("Collibra (Internal team)", "Collibra (Internal template)") last | - [x] | - [x] |
| (b) Alphabetical, no exceptions                                                                        | - [ ] | - [ ] |
| (c) By open-issue count                                                                                | - [ ] | - [ ] |


**Notes:**

---

## Q30 - Saved Views

You added saved views in Q5.


| Option                                                                                                                                                                                                             | Rec   | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| (a) You create, rename and delete views (a name plus filters and toggles). They're stored locally as JSON that the CLI also reads (`jm issue list --view mine`). "My issues" and "Current sprint" ship as starters | - [x] | - [x] |
| (b) Only the two fixed views, with no user-created views                                                                                                                                                           | - [ ] | - [ ] |
| (c) Views in the app only, none in the CLI                                                                                                                                                                         | - [ ] | - [ ] |


**Notes:**

---

## Q31 - Priority and Remaining Estimate

In Q5 you kept the `P` priority shortcut but in Q22 left Priority unticked. You also left remaining estimate unticked, although worklogs change it.

### Priority


| Option                                              | Rec   | Pick  |
| --------------------------------------------------- | ----- | ----- |
| (a) Drop Priority and the `P` shortcut              | - [ ] | - [ ] |
| (b) Keep Priority as a field, with the `P` shortcut | - [x] | - [x] |


### Remaining Estimate


| Option                                         | Rec   | Pick  |
| ---------------------------------------------- | ----- | ----- |
| (a) Show it read-only beside original estimate | - [x] | - [x] |
| (b) Hide it                                    | - [ ] | - [ ] |
| (c) Make it editable                           | - [ ] | - [ ] |


**Notes:**

---

## Q32 - CLI Command Shape


| Option                                                                                                                                                                                                                                                                | Rec   | Pick  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Noun-verb, like `gh`: `jm issue list/get/create/edit/delete`, `jm issue tree`, `jm comment add/edit/delete`, `jm worklog add/edit/delete`, `jm link add/remove/types`, `jm attach add/remove`, `jm sprint set/list`, `jm status set`, `jm field options customer` | - [x] | - [x] |
| (b) Flat verbs: `jm create`, `jm comment`, `jm log`, `jm link`                                                                                                                                                                                                        | - [ ] | - [ ] |


**Notes:**

---

## Q33 - Create Flow


| Option                                                                                                                                                                                                         | Rec   | Pick  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) `C` opens a Linear-style modal: type defaults to Story; parent, Customer and Engagement prefill from the selected issue; Customer and Engagement are required; a "Create more" toggle keeps the modal open | - [x] | - [x] |
| (b) A full-page create form                                                                                                                                                                                    | - [ ] | - [ ] |


**Notes:**

---

## Q34 - Attachments and Comments

### Drag and Drop


| Option                                                                                                                                   | Rec   | Pick  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| (a) Drop a file anywhere on the issue page to attach it; drop an image inside the description or a comment to attach and embed it inline | - [x] | - [x] |
| (b) A single drop zone in the attachments section                                                                                        | - [ ] | - [ ] |
| (c) Option (a) plus dropping onto a row in the list view                                                                                 | - [ ] | - [ ] |


### Comments


| Option                                                                            | Rec   | Pick  |
| --------------------------------------------------------------------------------- | ----- | ----- |
| (a) Add, edit and delete your own comments, using the same editor as descriptions | - [x] | - [x] |
| (b) Add only                                                                      | - [ ] | - [ ] |


**Notes:**

---

## Q35 - Labels

Jira labels are free text with no fixed list.


| Option                                                                           | Rec   | Pick  |
| -------------------------------------------------------------------------------- | ----- | ----- |
| (a) Autocomplete from labels already used in PSAPAC; typing a new one creates it | - [x] | - [x] |
| (b) Existing labels only                                                         | - [ ] | - [ ] |


**Notes:**