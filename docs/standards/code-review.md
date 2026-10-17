# Code Review

## Pull Requests

1. Open the pull request from your branch once it builds and its tests pass locally. Mark it draft if you want early feedback.
2. Fill in the template: what changed, why, how you tested it, and the `Refs` line.
3. Review your own diff before asking anyone else. Remove debug output, commented-out code and unrelated changes.
4. Keep it small: one self-contained concern, with its tests. Around 100 changed lines is a good size and 1,000 is too big, excluding generated files.
5. A reviewer other than the builder reviews it: Shane, or a review agent that did not write the change. An agent never reviews its own work, and a human reviews any change to authentication or token handling.
6. The reviewer approves once the change improves the code's health, even if it is not perfect, and prefixes optional suggestions with `Nit:`. The author answers every other comment with a fix or a reply.
7. Squash-merge once the local CI route passes and review approves (see [Git Workflow](git-workflow.md)).

## Reviewer Checks

- The change does what the issue asks, and nothing it does not.
- Jira access and domain rules sit in `@jira-mgr/core`, not in a client.
- Every value from Jira, CLI arguments or the settings file passes a schema at the boundary.
- No test writes to Jira, and no custom field id is hard-coded.
- Errors carry stable codes, and logs hold no tokens or personal data.
- Tests fail without the change and pass with it.
- Names and docs match the change.

## Definition of Done

A change is done when every item holds:

- [ ] The acceptance criteria are met, and each one is demonstrated by a test or a recorded manual check.
- [ ] The local CI route passes on the pushed head: format check, lint, type check, unit tests, build, reference docs, and end-to-end tests ([Local CI](git-workflow.md#local-ci)). The pull request records the pass and fail counts. A documentation-only change skips the end-to-end tests.
- [ ] Every bug fix has a regression test that failed before the fix.
- [ ] A new or changed Jira call has a fixture recorded from PSAPAC as recorded, from response bodies only, and runs against the MSW fake.
- [ ] A changed CLI command updates the command schema, so `docs/reference/cli.md` regenerates.
- [ ] Docs are updated: reference docs for a changed command, core export or setting, and an ADR for a decision that meets the three tests in `docs/adr/README.md`.
- [ ] A reviewer other than the builder approved it.
