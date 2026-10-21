# TypeScript Config

`@jira-mgr/config-ts`, the base `tsconfig` files every app and package extends. The repository has no root `tsconfig`.

| File        | For                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `base.json` | Shared flags: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, target `ES2024`, `noEmit` |
| `node.json` | Node packages: `module` and `moduleResolution` `NodeNext`                                                                   |
| `vite.json` | Vite apps: `moduleResolution` `Bundler`, DOM libraries, React JSX                                                           |

## Use

```json
{
  "extends": "@jira-mgr/config-ts/node.json",
  "include": ["src"]
}
```

Add `types` for the globals a package needs, such as `node`. Since TypeScript 6, no ambient types are included by default.

`tsc` only type checks here, because tsup, electron-vite and Vitest do the building.
