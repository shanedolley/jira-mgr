# Scripts

Repository automation that root `package.json` scripts and CI call.

| Script             | Does                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `jm.ts`            | Runs the built CLI for `pnpm jm`, dropping the `--` that pnpm forwards                                |
| `gen-reference.ts` | Writes `docs/reference/cli.md` and `errors.md` from the built CLI's `help --json`                     |
| `package.ts`       | Assembles `apps/desktop/dist/jira-mgr.app` for `pnpm package` and checks it holds no e2e or fake code |

Write scripts in TypeScript and run them with `node`, which strips types natively. Each script exits non-zero on failure and prints what to do next. A script that grows options or a test suite becomes a package in `packages/`.
