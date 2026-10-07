# L7 Smoke Check

**Use when:** after a change to `@jira-mgr/core` or the CLI, to confirm every `jm` command works against live PSAPAC. Issue [#27](https://github.com/shanedolley/jira-mgr/issues/27) holds the open questions this check answers.

**Severity:** the read-only and local sections change nothing in Jira. The live-write section creates, edits and deletes three throwaway issues in PSAPAC and logs time on them. Run it only with Shane present.

`jm` below means `pnpm -s jm --`, run from the repository root with Node 24 on the path. Record each outcome in the Result column as the exit code plus a short note. Never paste the token, and keep issue data brief.

## Before You Start

1. Run `jm auth status`. It must show `https://engineering-collibra.atlassian.net`, project `PSAPAC` and the right account. Do not run `jm auth login` or `jm auth logout` during the check.
2. Copy the state files so the check can restore them: `views.json` and `timer.json` in `~/Library/Application Support/jira-mgr/`. `JM_STATE_DIR` is not set for the real run.
3. Run `jm timer status`. The live-write section needs it to answer `null`. When a timer is running or paused, ask Shane whether it is real. Then discard it with `jm timer stop --discard`, or skip steps 39 to 43.
4. In a scratch folder outside the repository, create the two attachment files and set `SCRATCH` to the folder:
   - `printf 'jm L7 smoke attachment\n' > "$SCRATCH/l7-small.txt"`
   - `head -c 5242880 /dev/urandom > "$SCRATCH/l7-5mb.bin"`

## Read-Only Commands

Each command appears once. `PSAPAC-3068` is a Done Story with a Relates link and one worklog; `PSAPAC-3116` is an Epic.

| Command | Expected | Result |
|---|---|---|
| `jm auth status` | Exit 0. `data` holds the site, project, email, account id, display name and `fieldsResolvedAt`. | Exit 0. Site, project PSAPAC and display name correct. |
| `jm issue list --view my-issues --limit 5` | Exit 0. At most 5 issues in `data`, none Done. | Exit 0. 5 rows. |
| `jm issue tree --mine` | Exit 0. Issues grouped by Customer, then Epic. | Exit 0. 3 customers (BHP 4 Epics, Maybank 1, Collibra (Internal team) 2), 67 KB. |
| `jm issue get PSAPAC-3068` | Exit 0. One issue with description, subtasks and URL. | Exit 0. Parent PSAPAC-2832, status Done. Fields: id, key, summary, issueType, status, resolution, parentKey, assignee, labels, priority, customer, engagement, sprints, startDate, dueDate, estimates, timestamps, description, descriptionMarkdown, subtasks, url. |
| `jm issue get PSAPAC-999999` | Exit 3, `not_found`. | Exit 3, `not_found`. The message reads "to see it.. Check the key", with a doubled full stop. |
| `jm comment list PSAPAC-3068` | Exit 0. Comments oldest first. | Exit 0. `data` is `[]`. |
| `jm worklog list PSAPAC-3068` | Exit 0. One worklog of 2h. | Exit 0. One worklog, 7200 s. Its `comment` is an empty ADF doc, not `null`. |
| `jm link types` | Exit 0. Link types with inward and outward phrases. | Exit 0. 21 types, Blocks first (`is blocked by` / `blocks`). |
| `jm link list PSAPAC-3068` | Exit 0. One Relates link to PSAPAC-2840. | Exit 0. One link, direction outward, type Relates. |
| `jm attach list PSAPAC-3068` | Exit 0. Attachments of the issue. | Exit 0. `data` is `[]`. |
| `jm sprint list` | Exit 0. Active and upcoming sprints on board 1706. | Exit 0. 69 sprints. 10170 is active ("PS Sprint 36"); 10171 is the first future sprint. |
| `jm field options customer` | Exit 0. Id and name pairs. | Exit 0. 42 options, including "Collibra (Internal team)". |
| `jm field options engagement` | Exit 0. Id and name pairs. | Exit 0. 21 options, including "Non Collibra Engagement". |
| `jm field options priority` | Exit 0. Id and name pairs. | Exit 0. 11 options. |
| `jm field options issue-type` | Exit 0. Task, Bug, Story, Epic, Subtask. | Exit 0. Those 5. |
| `jm field options status` | Exit 0. Status names with ids. | Exit 0. 6 statuses: Hold, To Do, Review, In Progress, Done, Opportunity. |
| `jm help --json` | Exit 0. The full command schema. | Exit 0. 35 commands, 7 exit-code rows. |

## Local-Only Commands

These touch only the files in the state folder. The CLI has `view list` and no view writes.

| Command | Expected | Result |
|---|---|---|
| `jm view list` | Exit 0. The saved views. | Exit 0. 2 views: `my-issues`, `current-sprint`. File byte-identical afterwards. |
| `jm timer status` | Exit 0. `null`, or the timer with its draft worklog. | Exit 0. A paused timer on PSAPAC-12 (5400 s, 2026-10-06 22:00 to 23:30 UTC) was already in `timer.json`. Not started by this check. |
| `jm auth login` | Replaces the stored token. | Not run. Shane runs it. |
| `jm auth logout` | Removes the stored token. | Not run. The check would lose its credentials. |

The write steps below cover `timer start`, `timer pause`, `timer resume` and `timer stop`, because `start` and `stop` log time to Jira.

## Live Writes

Run the steps in order. Every write touches only the throwaway issues `T1`, `T2` and `T3`. Every summary starts with `[jm L7 smoke]`.

Parent for all three: Epic `PSAPAC-3116` ("Shane Dolley Administration & Sprint Activity"), Customer `Collibra (Internal team)`, Engagement `Non Collibra Engagement`. Read these with `jm issue get PSAPAC-3116` before step 1 and stop when they differ.

After each create, set the variable to the `key` in the output: `T1`, `T2`, `T3`. To read a result back, use `jm issue get $T1` and look at the named field. `--json` is the default when output is piped.

### Create

| # | Command | Expected | Result |
|---|---|---|---|
| 1 | `jm issue create --type Story --summary "[jm L7 smoke] story" --customer "Collibra (Internal team)" --engagement "Non Collibra Engagement" --parent PSAPAC-3116` | Exit 0. `key`, `id`, `url`. Set `T1`. | Exit 0. PSAPAC-3127 (T1). Jira automation then set label PSAPAC, original estimate 14400, remaining 0 and Time remaining 0, then 4. |
| 2 | `jm issue create --type Task --summary "[jm L7 smoke] task" --customer "Collibra (Internal team)" --engagement "Non Collibra Engagement" --parent PSAPAC-3116` | Exit 0. Set `T2`. | Exit 0. PSAPAC-3128 (T2). Automation moved it to Epic PSAPAC-1792, Customer BHP and the active sprint 10170. See Findings 1. |
| 3 | `jm issue create --type Subtask --summary "[jm L7 smoke] subtask" --customer "Collibra (Internal team)" --engagement "Non Collibra Engagement" --parent $T1` | Exit 0, or exit 2 when Jira's Subtask screen refuses a field. Record the message. Set `T3`. | Exit 0. PSAPAC-3129 (T3). Parent T1, Customer and Engagement accepted. No estimate set. |

### Edit

| # | Command | Expected | Result |
|---|---|---|---|
| 4 | `jm issue edit $T1 --assignee me --start 2026-10-12 --due 2026-10-14 --priority Minor --add-label l7-smoke --description "L7 smoke check"` | Exit 0. `changed` names each option. `issue get $T1` shows each value. | Exit 0. `changed`: description, assignee, start, due, priority, label. All values read back. |
| 5 | `jm issue edit $T1 --type Task` | Exit 0 and `issueType` Task, or the Jira error. Answers #27 item "issue type change". | Exit 0. `changed`: type. Type reads back as Task. |
| 6 | `jm issue edit $T1 --type Bug` | Exit 0 and `issueType` Bug. | Exit 0. Type reads back as Bug. |
| 7 | `jm issue edit $T1 --type Story` | Exit 0 and `issueType` Story again. | Exit 0. Type reads back as Story. |
| 8 | `jm issue edit $T1 --type Epic` | Exit 2, `validation_failed`, from the CLI. Nothing is sent. | Exit 2, `validation_failed`: "argument 'Epic' is invalid. Allowed choices are Story, Task, Bug." Nothing sent. |
| 9 | `jm issue edit $T1 --estimate 2h` | Exit 0. Read `originalEstimateSeconds` and `remainingEstimateSeconds`. Record both. Expect 7200 and, if Jira derives it, 7200. | Exit 0. T1 already had original 14400 and remaining 0 from automation. After the edit: original 7200, remaining 7200 (from 0). Time remaining (h) went 4 then 2 within 6 s (automation). |
| 10 | `jm issue edit $T1 --estimate 4h` | Exit 0. Original 14400. Record whether remaining moved to 14400 or stayed at the step 9 value. Call that value `R0`. | Exit 0. Original 14400, remaining 14400, Time remaining (h) 4. `R0` = 14400. |
| 11 | `jm issue edit $T1 --time-remaining 3` | Exit 0. `timeRemainingHours` is 3. `remainingEstimateSeconds` is still `R0`. | Exit 0. Time remaining (h) 3. Remaining estimate unchanged at 14400. Still 3 after 8 s. |
| 12 | `jm issue edit $T1 --time-remaining none` | Exit 0. `timeRemainingHours` is `null`. | Exit 0. Time remaining (h) `null`. Remaining unchanged. Still `null` after 8 s. |
| 13 | `jm issue edit $T3 --start 2026-10-12` | Exit 2, `validation_failed` carrying Jira's 400. Subtask has no Start date. Record how the CLI words it. | Exit 0, not 2. `changed`: start. Start date reads back 2026-10-12. Jira accepted it on a Subtask. |
| 14 | `jm issue edit $T3 --time-remaining 2` | Exit 2 as in step 13. | Exit 0, not 2. Time remaining (h) reads back 2. |
| 15 | `jm issue edit $T3 --priority Minor` | Exit 2 as in step 13. | Exit 0. Minor was already the value, so nothing visible changed. See step 15b. |
| 15b | `jm issue edit $T3 --priority Major` | Added. Exit 2 if Subtask has no Priority; otherwise a changed value. | Exit 0. Priority reads back Major. |
| 16 | `jm issue edit $T3 --summary "[jm L7 smoke] subtask renamed"` | Exit 0. Control: a Subtask edit of an allowed field works. | Exit 0. Summary reads back renamed. |
| 17 | `jm status set $T2 "In Progress"` | Exit 0, `changed` true. | Exit 0. `changed` true. |
| 18 | `jm status set $T2 "To Do"` | Exit 0, `changed` true. | Exit 0. `changed` true. |

### Comments

| # | Command | Expected | Result |
|---|---|---|---|
| 19 | `jm comment add $T1 --body "L7 comment on T1"` | Exit 0. Note the id as `C1`; `jm comment list $T1` shows it. | Exit 0. `C1` = 1958813. |
| 20 | `jm comment add $T2 --body "L7 comment on T2"` | Exit 0. Note the id as `C2`; it belongs to `T2`. | Exit 0. `C2` = 1958814. |
| 21 | `jm comment edit $T1 $C1 --body "L7 comment edited"` | Exit 0. `comment list $T1` shows the new body. | Exit 0. Body reads back "L7 comment edited". |
| 22 | `jm comment edit $T1 $C2 --body "must not apply"` | Jira refuses the foreign id: exit 3 or exit 2. `comment list $T2` still shows the original body. | Exit 3, `not_found`: Jira 404 "No comment with given ID found for issue PSAPAC-3127". T2's comment unchanged. |
| 23 | `jm comment delete $T1 $C2` | Jira refuses as in step 22. `comment list $T2` still lists `C2`. | Exit 3, `not_found`, same 404. `C2` still listed on T2. |
| 24 | `jm comment delete $T1 $C1` | Exit 0. `comment list $T1` is empty. | Exit 0. T1 has no comments. |

### Worklogs

`jm` sends `adjustEstimate=auto`. Read `remainingEstimateSeconds` with `jm issue get $T1` after each step. `R0` is the value from step 10.

| # | Command | Expected | Result |
|---|---|---|---|
| 25 | `jm worklog add $T1 --time 30m --comment "L7 worklog"` | Exit 0. Note the id as `W1`. Remaining is `R0` minus 1800. | Exit 0. `W1` = 177249. Remaining 12600 (R0 minus 1800). Time remaining (h) 3.5. |
| 26 | `jm worklog add $T2 --time 15m` | Exit 0. Note the id as `W2`; it belongs to `T2`. | Exit 0. `W2` = 177250. T2 `comment` is `null`. |
| 27 | `jm worklog edit $T1 $W1 --time 1h` | Exit 0. Remaining is `R0` minus 3600. | Exit 0. Remaining 10800 (R0 minus 3600). Time remaining (h) 3. |
| 28 | `jm worklog edit $T1 $W2 --time 5m` | Jira refuses the foreign id: exit 3 or exit 2. `worklog list $T2` still shows 15m. | Exit 0, not a refusal. Jira edited T2's worklog through T1's key: `worklog list T2` shows 5m. See Findings 2. |
| 29 | `jm worklog delete $T1 $W2` | Jira refuses as in step 28. `worklog list $T2` still lists `W2`. | Exit 0, not a refusal. Jira deleted T2's worklog through T1's key: `worklog list T2` is empty. |
| 30 | `jm worklog delete $T1 $W1` | Exit 0. Remaining returns to `R0`. | Exit 0. Remaining back to 14400. Time remaining (h) 4. |

### Links

| # | Command | Expected | Result |
|---|---|---|---|
| 31 | `jm link add $T1 blocks $T2` | Exit 0. `link list $T1` shows outward "blocks" `T2`. `link list $T2` shows inward "is blocked by" `T1`. Note the link id as `L1`. | Exit 0. Link 642473, direction outward. `link list T1` shows outward "blocks" T2. `link list T2` shows inward "is blocked by" T1. |
| 32 | `jm link remove $L1` | Exit 0. Both `link list` calls are empty. | Exit 0. Both `link list` calls answer `[]`. |

### Attachments

| # | Command | Expected | Result |
|---|---|---|---|
| 33 | `jm attach add $T1 "$SCRATCH/l7-small.txt"` | Exit 0. One attachment, `size` 23, `mimeType` text/plain. Note the id as `A1`. | Exit 0. Attachment 658692, size 23, text/plain. |
| 34 | `jm attach add $T1 "$SCRATCH/l7-5mb.bin"` | Exit 0 inside the size-scaled timeout. `size` 5242880. Record the elapsed seconds. Note the id as `A2`. | Exit 0. Attachment 658693, size 5242880, application/octet-stream. 4 s elapsed. |
| 35 | `jm attach remove $A1` | Exit 0. | Exit 0. |
| 36 | `jm attach remove $A2` | Exit 0. `attach list $T1` is empty. | Exit 0. `attach list T1` answers `[]`. |

### Sprints

Board 1706. Use the first sprint with state `future` in `jm sprint list` (10171 at the last run), never the active one.

| # | Command | Expected | Result |
|---|---|---|---|
| 37 | `jm sprint set 10171 $T1` | Exit 0. `sprint` names the target. `issue get $T1` lists it under `sprints`. | Exit 0. `sprint` id 10171 "PS Sprint 37". `sprints` on T1 lists it. |
| 38 | `jm sprint set backlog $T1` | Exit 0, `sprint` null. `sprints` on `T1` is empty. | Exit 0. `sprint` null. `sprints` on T1 is `[]`. |

### Timer

Needs `jm timer status` to answer `null`. `--expect` makes the start refuse when another issue's timer runs.

| # | Command | Expected | Result |
|---|---|---|---|
| 39 | `jm timer start $T2 --expect $T2` | Exit 0, state `running`. With a leftover timer it exits 2 and logs nothing. | Exit 0. State `running`. Draft already shows 300 s (5m, the rounding floor). |
| 40 | `jm timer pause` | Exit 0, state `paused`. | Exit 0. State `paused`, 5 s elapsed. |
| 41 | `jm timer resume` | Exit 0, state `running`. | Exit 0. State `running`. |
| 42 | `jm timer stop --expect $T2 --comment "L7 timer"` | Exit 0. A worklog on `T2` with the rounded time. Record the time. | Exit 0. Worklog 177251 on T2: 5m, comment "L7 timer". Measured time was under 1 minute. |
| 43 | `jm worklog list $T2` | Two worklogs: `W2` and the timer's. `jm timer status` answers `null`. | One worklog, not two: `W2` was deleted at step 29. The timer's worklog is listed. `timer status` answers `null`. |

### Cleanup

| # | Command | Expected | Result |
|---|---|---|---|
| 44 | `jm issue delete $T1 --confirm` | Exit 2, `validation_failed`: `T1` has a subtask. Nothing is deleted. | Exit 2, `validation_failed`: "PSAPAC-3127 has subtasks PSAPAC-3129". Nothing deleted. |
| 45 | `jm issue delete $T1 --confirm --with-subtasks` | Exit 0. `deletedSubtasks` lists `T3`. | Exit 0. `deletedSubtasks`: PSAPAC-3129. |
| 46 | `jm issue delete $T2 --confirm` | Exit 0. Its comment and worklogs go with it. | Exit 0. `deletedSubtasks`: `[]`. |

## Verify

1. `jm issue get $T1`, `jm issue get $T2` and `jm issue get $T3` each exit 3.
2. `jm issue list --search "jm L7 smoke" --show-done` returns no issue.
3. `jm timer status` answers `null`. `views.json` and `timer.json` match the copies from Before You Start, except for a timer the check logged and cleared.
4. Compare the Result column with the questions in #27, and comment the answers there.

## Findings

Run on 2026-10-08 with Shane present. Throwaways: PSAPAC-3127 (T1), PSAPAC-3128 (T2), PSAPAC-3129 (T3), all deleted. Shane approved discarding the leftover paused timer on PSAPAC-12 (`timer stop --discard`, nothing logged). Steps 1 to 46 ran in order, plus step 15b.

Answers to the #27 questions:

| Question | Answer |
|---|---|
| Issue type change between Story, Task and Bug via PUT | Works. Steps 5 to 7 exit 0 and the type reads back each time. |
| `originalEstimate` alone and the remaining estimate | Setting it also sets the remaining estimate to the same value, even when remaining was 0 (step 9) or already differed (step 10). Time remaining (h) then follows within seconds (see Finding 1). |
| Subtask edits of Start date, Time remaining and Priority return 400 | False. Steps 13, 14 and 15b exit 0 and the values read back. Subtask accepts all three. |
| `sprint set` into a sprint and back to the backlog on board 1706 | Works. Steps 37 and 38 exit 0 and `sprints` reads back. |
| Worklog add, edit and delete with `adjustEstimate=auto` | Works. Remaining went 14400, 12600, 10800, 14400 across steps 25, 27 and 30. |
| Attachment upload, small and 5 MB | Works. Steps 33 and 34 exit 0. The 5 MB upload took 4 s. |
| Foreign comment id through a PSAPAC key | Jira refuses with a 404, exit 3 (steps 22 and 23). The other issue's comment is untouched. |
| Foreign worklog id through a PSAPAC key | Jira does not refuse (Finding 2). |
| Timer start, pause, resume, stop to a throwaway | Works. Step 42 logged one 5m worklog (the rounding floor for under a minute of timing). |
| Link direction | Verified earlier. Step 31 confirms again: T1 "blocks" T2 reads inward "is blocked by" on T2. |

Findings:

1. A PSAPAC Automation for Jira rule changes new issues after the create call. It adds the label `PSAPAC` and sets the original estimate to 14400 with remaining 0 on every new Story and Task, and sets Time remaining (h). It also keeps Time remaining (h) equal to the remaining estimate after later estimate edits and worklogs, but a direct `--time-remaining` edit stuck (steps 11 and 12). On T2 (a Task) the rule also set the sprint to the active sprint 10170, the Customer to BHP and the parent to Epic PSAPAC-1792, replacing the values the CLI sent. `issue create` returns only the key, so the caller sees no sign that the issue differs from the request. The parent Epic PSAPAC-1792 was not modified.
2. `worklog edit` and `worklog delete` do not check that the worklog belongs to the issue in the command. Steps 28 and 29 edited and then deleted T2's worklog through T1's key, exit 0. The CLI's project guard checks only the key, so `jm worklog delete PSAPAC-1 <id of a worklog on another issue>` removes that worklog. Comments are safe: Jira answers 404. Fix in core: `getWorklog` the id first and compare its `issueId` with the issue, or refuse when the lookup misses.
3. Errors that quote a Jira message, such as `not_found` from `issue get`, read "to see it.. Check the key", with a doubled full stop. The message already ends in a full stop and core appends another.
4. `issue get FOO-1`, a key outside PSAPAC, exits 3 from Jira's 404, not 2. The "outside the project" exit 2 guard covers writes only.
5. `worklog list` returns a worklog `comment` as an empty ADF doc (`{"version":1,"type":"doc","content":[]}`) when the worklog has no comment. `worklog add` returns `null` for the same case.
6. Step 43 expected two worklogs and found one, because step 29 deleted `W2` (Finding 2).

## Follow Up

- Open a bug for each Result that differs from Expected, and `Refs #27` in the fix.
- Open issues for Findings 2 to 5, and tell Shane about Finding 1.
