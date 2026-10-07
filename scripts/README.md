# Scripts

Repository automation that root `package.json` scripts and CI call.

| Script  | Does                                                                   |
| ------- | ---------------------------------------------------------------------- |
| `jm.ts` | Runs the built CLI for `pnpm jm`, dropping the `--` that pnpm forwards |

Write scripts in TypeScript and run them with `node`, which strips types natively. Each script exits non-zero on failure and prints what to do next. A script that grows options or a test suite becomes a package in `packages/`.
