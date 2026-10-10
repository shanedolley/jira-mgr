# Documentation

## Where Docs Go

Each page is one [Diataxis](https://diataxis.fr/) kind. Split a page that mixes them.

| Content | Location |
|---|---|
| A lesson for a newcomer | `docs/tutorials/` |
| A recipe for one task | `docs/how-to/` |
| Facts to look up: commands, errors, config, shortcuts | `docs/reference/` |
| How the system fits together, and why | `docs/architecture/` |
| A decision and the options weighed | `docs/adr/` |
| A design for a large feature, before it is built | `docs/design/` |
| Steps for a token or Jira problem | `docs/runbooks/` |
| A rule contributors follow | `docs/standards/` |
| Threat model | `docs/security/` |
| The roadmap, requirements and acceptance criteria | `docs/product/` |
| Research, spikes and question rounds | `docs/discovery/` |
| Domain terms | `CONTEXT.md` |
| A package's purpose and local rules | That package's `README.md` |

## Rules

- Update docs in the same pull request as the change they describe.
- `.github/CODEOWNERS` names every doc's owner, who reviews changes to it and keeps it current.
- Accepted ADRs are never edited. A new ADR supersedes an old one.
- Generated reference (CLI commands, error codes) is regenerated, never edited by hand.
- Name files in `kebab-case`. Prefix discovery records with their date: `2026-10-07-product-grilling.md`.
- Start new runbooks, design docs and discovery records from `docs/templates/`.
- Every folder's `README.md` indexes what it holds. Add a line there when you add a file.

## Writing

- Open with the content. Skip sentences that describe the document.
- Use active voice, positive statements and concrete words. Cut every sentence that changes nothing the reader does.
- Headings name the subject in four words or fewer, never as a question.
- Use hyphens. Never use em dashes or en dashes.
- Say each thing once, in its one home, and link to it from elsewhere.
- Put the reasoning for a decision in its ADR or pull request. A standard states the rule.
