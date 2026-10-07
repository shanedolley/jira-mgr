# Grilling Round 6: Timer and Test Fixtures

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation. Manual worklogs ("15m") stay as decided in Q11; the timer adds a second way to create one.

---

## Q49 - Shared Timer State


| Option                                                                                                                                                                                        | Rec | Pick  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) One timer state file in the app's config folder, shared by the app and `jm timer start/stop/status`. The timer survives quitting the app, and either side can stop what the other started | [x] | - [x] |
| (b) The timer lives in the app only, and stops when the app quits                                                                                                                             | [ ] | [ ]   |
| (c) Separate timers for the app and the CLI                                                                                                                                                   | [ ] | [ ]   |


**Notes:**

---

## Q50 - Concurrent Timers


| Option                                                                                             | Rec | Pick  |
| -------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) One timer at a time. Starting a timer on another issue stops the running one and logs it first | [x] | - [x] |
| (b) One timer at a time. Starting another is refused until you stop the first                      | [ ] | [ ]   |
| (c) Several timers running at once                                                                 | [ ] | [ ]   |


**Notes:**

---

## Q51 - Stopping a Timer


| Option                                                                                                                                                                                                                                                        | Rec | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) App: stop opens the log-work dialog prefilled with the elapsed time and the timer's start time, so you can add a comment, adjust the time or discard. CLI: `jm timer stop` logs straight away, with optional `--comment`, and `--discard` drops the timer | [x] | - [x] |
| (b) Stop logs straight away in both, with no dialog                                                                                                                                                                                                           | [ ] | [ ]   |


**Notes:**

---

## Q52 - Rounding

Jira's smallest worklog unit is one minute.


| Option                                                      | Rec | Pick  |
| ----------------------------------------------------------- | --- | ----- |
| (a) Round to the nearest minute, with a one-minute minimum  | [x] | [ ]   |
| (b) Round up to the next 15 minutes                         | [ ] | [ ]   |
| (c) A rounding setting (none, 5m, 15m) in the settings file | [ ] | - [x] |


**Notes: default to 5m**

---

## Q53 - Pause


| Option                                                              | Rec | Pick  |
| ------------------------------------------------------------------- | --- | ----- |
| (a) No pause. Stop and start again, which produces two worklogs     | [x] | [ ]   |
| (b) Pause and resume, logging one worklog with paused time excluded | [ ] | - [x] |


**Notes:**

---

## Q54 - Timer Visibility and Controls


| Option                                                                                                                                                                                                                                        | Rec | Pick  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) `T` starts or stops the timer on the selected issue. A running timer shows elapsed time on the issue row, the issue page and the sidebar, plus a macOS menu bar item with elapsed time and Stop that stays while the app window is closed | [x] | [ ]   |
| (b) As (a), without the menu bar item                                                                                                                                                                                                         | [ ] | - [x] |
| (c) Timer buttons on the issue page only                                                                                                                                                                                                      | [ ] | [ ]   |


**Notes:**

---

## Q55 - Forgotten Timers


| Option                                                                                                              | Rec | Pick  |
| ------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) Stopping a timer that ran past 8 hours, or across midnight, asks you to confirm or edit the time before logging | [x] | [ ]   |
| (b) As (a), plus a reminder notification each hour a timer runs past 8 hours                                        | [ ] | - [x] |
| (c) No check                                                                                                        | [ ] | [ ]   |


**Notes: Have the notification configurable. Default to notify every hour**

---

## Q56 - Issue Types With a Timer

Time tracking sits on Task, Bug, Story and Subtask screens, not on Epics.


| Option                                                      | Rec | Pick  |
| ----------------------------------------------------------- | --- | ----- |
| (a) Timer and log work on Task, Bug, Story and Subtask only | [x] | - [x] |
| (b) Also on Epics, if Jira accepts worklogs there           | [ ] | [ ]   |


**Notes:**

---

## Q57 - Recorded Fixtures in the Repo

The testing standard calls for MSW fixtures recorded from PSAPAC. PSAPAC holds Collibra customer data, and this is a personal repo.


| Option                                                                                                                                                                                                                                  | Rec | Pick |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- |
| (a) Fixtures are hand-written or recorded then scrubbed: customer names, summaries, descriptions, comments, people, emails and account ids are all replaced with synthetic values. Field ids, option shapes and API structure stay real | [x] | [ ]  |
| (b) Commit recorded responses with only tokens, emails and account ids stripped                                                                                                                                                         | [ ] | [ ]  |
| (c) Keep fixtures out of the repo, in a gitignored local folder                                                                                                                                                                         | [ ] | [ ]  |


**Notes: This app is approved to hold PSAPAC customer data. Superseded by Q60.**