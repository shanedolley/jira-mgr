# TypeScript

## Compiler

`@jira-mgr/config-ts` sets these for every package:

- `strict`, `noUncheckedIndexedAccess` and `noImplicitOverride`
- `verbatimModuleSyntax`, so type-only imports use `import type`
- ES modules only: `"type": "module"` in each `package.json`, `module: "NodeNext"` for Node packages, `moduleResolution: "Bundler"` for the Electron renderer
- a target matching the Node version in `.nvmrc`

A `// @ts-expect-error` carries a comment saying why. `@ts-ignore` is banned.

## Packages

- Each package extends `@jira-mgr/config-ts`. The repository has no root `tsconfig`.
- Import another package by its name (`@jira-mgr/core`), never by a relative path that leaves the package.
- Packages sit one level deep in `apps/` or `packages/`, never nested.
- Each package declares its public entry points in `exports`. Skip barrel files (`index.ts` that only re-exports), and import from the module that defines a symbol.

## Types

- Use `unknown` for values of unknown shape, then narrow. `any` needs a lint-disable comment with a reason.
- Model choices as string literal unions or `as const` objects, not `enum`.
- Derive Jira shapes from the schemas in `@jira-mgr/core`. Never hand-write a type for a Jira response.
- Model states as discriminated unions, so impossible states cannot be written.
- Export named symbols. Default exports are allowed only where a framework demands them.

## Validation

Validate every value that crosses a trust boundary with a schema: Jira API responses, CLI arguments and files, the settings file, the saved views file and environment variables. Derive the TypeScript type from the schema, so the two cannot drift. Inside the boundary, trust the types.

Jira responses are the widest boundary. Read only the fields core needs, tolerate the ones it does not know, and fail with a typed error when a required field is missing.

## Async Code

- Await or explicitly return every promise. The lint rule `no-floating-promises` enforces it.
- Pass an `AbortSignal` through long-running calls, so Ctrl-C in the CLI and unmounting in the UI cancel cleanly.
