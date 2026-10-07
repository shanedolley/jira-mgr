# Grilling Round 7: Timer Follow-ups

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation.

---

## Q58 - Rounding Direction

You chose a rounding setting (none, 5m, 15m) defaulting to 5m (Q52).

| Option | Rec | Pick |
|---|---|---|
| (a) Round to the nearest step, with one step as the minimum: 7m logs 5m, 8m logs 10m, 2m logs 5m | [x] | [x] |
| (b) Always round up: 6m logs 10m | [ ] | [ ] |
| (c) Always round down, with one step as the minimum | [ ] | [ ] |

**Notes:**

---

## Q59 - Switching Timers in the App

Starting a timer on another issue logs the running one first (Q50), and stopping in the app opens the log-work dialog (Q51).

| Option | Rec | Pick |
|---|---|---|
| (a) Switching opens the dialog for the running timer; confirming or discarding it starts the new timer | [x] | [x] |
| (b) Switching logs the running timer straight away with no dialog, and a toast names what was logged | [ ] | [ ] |

**Notes:**

---

## Q60 - Fixture Policy

Q57 had no pick; your note says the app is approved to hold PSAPAC customer data. I read that as option (b), which `docs/standards/testing.md` already describes.

| Option | Rec | Pick |
|---|---|---|
| (a) Commit recorded PSAPAC responses with tokens, emails and account ids stripped (Q57 b) | [x] | [ ] |
| (b) Scrub customer content too (Q57 a) | [ ] | [ ] |
| (c) Commit recorded PSAPAC responses as recorded, with no scrubbing or obfuscation of any data | [ ] | [x] |

**Notes:** Option (c) is your answer. Nothing in a recorded response is scrubbed or obfuscated, and you confirm the repo and the app are approved to hold PSAPAC data. Credentials are still never recorded: recordings save response bodies only, never request headers.

---

## Timer Defaults

These follow from your answers and need no tick unless you disagree:

- Pause and resume keep one timer and log one worklog with paused time excluded (Q53). The state file records each running segment, so pause works from the CLI too (`jm timer pause/resume`).
- With no menu bar item (Q54), reminders come from the app while it runs, including with its window closed. The CLI cannot send them, and a quit app sends none.
- The reminder threshold (8 hours) and interval (every hour) both live in the settings file (Q55).

**Notes:**
