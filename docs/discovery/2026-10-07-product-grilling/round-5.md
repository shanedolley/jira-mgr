# Grilling Round 5: Repo Scaffold

Tick one box in the **Pick** column per question, and add anything else under **Notes**. **Rec** marks my recommendation.

Nisaba contains no code. Each `apps/*` and `packages/*` folder holds a single README. It has no tsconfig, lint config or workflow YAML, only a CI plan in `.github/workflows/README.md`. It supplies the layout, standards, templates and conventions; jira-mgr has to choose its own tooling.

---

## Q39 - Scaffold Depth


| Option                                                                                                                                                                                               | Rec | Pick  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) Mirror Nisaba: root files, `docs/` (Diataxis, with standards and templates), `.github/` templates, and a README per `apps/*` and `packages/*` folder. Tooling configs arrive with the build plan | [x] | - [x] |
| (b) As (a), plus working tooling now: tsconfigs, lint, Vitest, empty apps that build, and a CI workflow                                                                                              | [ ] | - [x] |


**Notes:**

---

## Q40 - Workspace Layout


| Option                                                                                                                                                                                                                                         | Rec | Pick  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) `apps/desktop` (Electron, renderer inside), `apps/cli` (`jm`), `packages/core` (Nisaba's `sdk` equivalent), `packages/config-ts`, `packages/config-lint`, `e2e/`, `scripts/`. No `ui`, `editor`, `web`, `collab`, `db-types` or `supabase` | [x] | - [x] |
| (b) As (a), plus `packages/ui` and `packages/editor` as separate packages, as in Nisaba                                                                                                                                                        | [ ] | [ ]   |


**Notes:**

---

## Q41 - Tooling Named in the Standards

The standards documents name tools, so these need choosing now even though configs come later.


| Option                                                                                                                                                                                                   | Rec | Pick  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) pnpm workspaces (no Turbo, as in Nisaba), electron-vite for desktop, tsup for the CLI, Vitest, Playwright's Electron driver for e2e, ESLint flat config and Prettier in `config-lint` (as in Nisaba) | [x] | - [x] |
| (b) As (a), but Biome replaces ESLint and Prettier                                                                                                                                                       | [ ] | [ ]   |


**Notes:**

---

## Q42 - Naming


| Option                                                                                              | Rec | Pick  |
| --------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) Package scope `@jira-mgr/*`, env var prefix `JM_` (`JM_DEBUG`), CLI commands `jm <noun> <verb>` | [x] | - [x] |
| (b) Different names (notes)                                                                         | [ ] | [ ]   |


**Notes:**

---

## Q43 - Work Tracking

Nisaba tracks work in Jira (project NIS) and writes `Refs NIS-12` in commits.


| Option                                                                                                                 | Rec | Pick  |
| ---------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) GitHub issues on `shanedolley/jira-mgr`, `Refs #12` in commits and PRs, using Nisaba's bug and feature issue forms | [x] | - [x] |
| (b) A new Jira project on Koinon (for example `JM`)                                                                    | [ ] | [ ]   |
| (c) An existing Koinon project, such as KOT (notes)                                                                    | [ ] | [ ]   |


**Notes:**

---

## Q44 - Grilling Records

Nisaba keeps its grilling as one discovery record, `docs/discovery/2026-10-06-architecture-grilling.md`.


| Option                                                                                                                                                                                        | Rec | Pick  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) `decisions.md` becomes `docs/discovery/2026-10-07-product-grilling.md`; the round files move to `docs/discovery/2026-10-07-product-grilling/` as evidence, so the Q numbers still resolve | [x] | - [x] |
| (b) Keep `docs/grilling/` as it is                                                                                                                                                            | [ ] | [ ]   |


**Notes:**

---

## Q45 - Licence

Nisaba is proprietary (Koinon, `UNLICENSED`). jira-mgr is a private repo on your personal account.


| Option                                                       | Rec | Pick  |
| ------------------------------------------------------------ | --- | ----- |
| (a) Proprietary, yours personally, `"license": "UNLICENSED"` | [x] | - [x] |
| (b) MIT                                                      | [ ] | [ ]   |
| (c) Proprietary, Koinon                                      | [ ] | - [ ] |


**Notes:** 

---

## Q46 - Jira in Tests


| Option                                                                                                                                                                                                      | Rec | Pick  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- |
| (a) Tests never touch real Jira: `core` tests run against an in-process fake (MSW) fed by recorded PSAPAC responses, with secrets stripped. A manual smoke checklist in `docs/runbooks/` covers live PSAPAC | [x] | - [ ] |
| (b) Tests also run live reads against PSAPAC, behind an opt-in env var                                                                                                                                      | [ ] | - [x] |


**Notes: You may create an epic under Collibra (Internal Team) called "Shane - Jira tests" for your testing.**

---

## Q47 - ADRs in This Branch


| Option                                                                                                                                                                                                                                                                               | Rec | Pick  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ----- |
| (a) Write these ADRs during the scaffold, before any code: 0001 shared `core` monorepo; 0002 direct-to-Jira live fetch with no replica; 0003 token in a Keychain item of the app's own; 0004 resolving custom fields by name; 0005 TipTap with ADF round-trip, keeping unknown nodes | [x] | - [x] |
| (b) Write them with the build plan instead                                                                                                                                                                                                                                           | [ ] | [ ]   |


**Notes:**

---

## Q48 - Empty Doc Folders

Nisaba creates every docs folder now, each with a README index whose rows say which milestone writes the page.


| Option                                                                 | Rec | Pick  |
| ---------------------------------------------------------------------- | --- | ----- |
| (a) Same: every folder and README index now, with planned pages listed | [x] | - [x] |
| (b) Create folders only when they have content                         | [ ] | [ ]   |


**Notes:**