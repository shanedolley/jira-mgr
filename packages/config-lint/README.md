# Lint Config

`@jira-mgr/config-lint`, the shared Prettier config.

The root `package.json` points Prettier at `@jira-mgr/config-lint/prettier`. `pnpm format` writes and `pnpm format:check` verifies. `.prettierignore` skips `docs/`, root Markdown files and `.github/`.

Linting is not here. Oxlint reads the root `.oxlintrc.json`, and `pnpm lint` runs it over the whole repository with type-aware rules. A suppression is `// eslint-disable-next-line <rule> -- <reason>` or `// oxlint-disable-next-line <rule> -- <reason>`; Oxlint honours both.
