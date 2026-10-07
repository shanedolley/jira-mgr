# Lint Config

`@jira-mgr/config-lint`, the shared ESLint flat config and the Prettier config.

## ESLint

The root `eslint.config.js` re-exports the config, and `pnpm lint` runs it over the whole repository. The config holds:

- `@eslint/js` recommended rules
- `typescript-eslint` strict and stylistic rules with type information, for `.ts` and `.tsx` files
- React and React Hooks rules, for `.tsx` files
- `@ts-ignore` banned; `@ts-expect-error` needs a description

Every TypeScript file must belong to a `tsconfig`, because the type-aware rules read it.

## Prettier

The root `package.json` points Prettier at `@jira-mgr/config-lint/prettier`. `pnpm format` writes and `pnpm format:check` verifies. `.prettierignore` skips `docs/`, root Markdown files and `.github/`.

## Versions

ESLint stays on 9 and TypeScript on 6.0 until `eslint-plugin-react` and `typescript-eslint` support the next majors.
