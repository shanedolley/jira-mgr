# Add a CLI Command

A command is a spec in the schema, a handler and a test. The schema is the one source for `--help`, `jm help --json` and [the reference](../reference/cli.md), so you never write help text twice ([design 0001](../design/0001-cli-command-schema.md)). A new command is additive, but changing an existing command's `--json` shape or exit codes needs Shane's approval first ([AGENTS.md](../../AGENTS.md)).

## Steps

1. **Put the Jira logic in core.** The CLI calls core and nothing else. Add or reuse a function in `packages/core/src` and test it against the MSW fake.

2. **Add the spec.** Append an object to `COMMANDS` in `apps/cli/src/schema.ts`, under the comment for its milestone. A spec has:

   | Field | Holds |
   |---|---|
   | `path` | `['view', 'list']`. The id is the path joined with spaces |
   | `summary` | One line for tables and parent help |
   | `args`, `options` | Names in kebab-case, a value `type`, a description. `none` clears an option marked `clearable` |
   | `examples` | At least one, starting with `jm` and the command path |
   | `output` | A `summary` and an `example` of the `data` the JSON envelope carries |
   | `exits` | Command-specific `code` and `when` pairs |
   | `writes` | `[]` for a read, else any of `jira`, `state`, `keychain` |
   | `calls` | The core functions, such as `@jira-mgr/core/state#readViews` |

   A new noun also needs a line in `NOUNS`.

3. **Write the handler.** Create `apps/cli/src/commands/<noun>/<verb>.ts` exporting a `Handler<SpecOf<'noun verb'>, Data>`. `run(input, ctx)` returns the data, which becomes `data` in the envelope. `render(data, tty)` returns the terminal form. `apps/cli/src/commands/view/list.ts` is the smallest example. For a Jira call, use `ctx.http()` and pass `ctx.signal`. For a write, call `assertInProject(key)` first. Throw `JiraMgrError` with a stable code, and the exit code follows.

4. **Register it.** Add the handler to `HANDLERS` in `apps/cli/src/commands/index.ts`. A spec without a handler stays out of `--help`, `jm help --json` and the reference.

5. **Test it.** Create `<verb>.int.test.ts` beside the handler. `run(argv, io, deps)` runs the whole command in process, so the test covers parsing, the handler, the envelope and the exit code.
   - Serve Jira with the helpers in `apps/cli/src/test-read.ts` and `test-write.ts` (`serveReads`, `serveWrites`), and run with `runJson` or `runTty`.
   - Give a state-only command `useEmptyState()` from `test-auth.ts`.
   - Call `expectShape(data, spec.output.example)` so the example in the schema matches what the handler returns.
   - Assert the exit code of each error path.
   - Never write to Jira; the fake records the requests.

   The CLI has no subprocess suite yet. `apps/cli/src/bin.test.ts` smoke-tests the built binary only.

6. **Regenerate the reference.**

   ```
   pnpm docs:reference
   ```

   This builds the CLI and rewrites `docs/reference/cli.md` and `errors.md`. Commit both. CI fails when they differ from the schema.

7. **Check.** Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check`. `apps/cli/src/schema.test.ts` also checks that names are kebab-case, that every example parses and that every exit names a known code.

## Rules

- Only `jm auth login` may prompt. Every other command exits 2 when a value is missing.
- `stdout` carries the result. Notes and progress go to `stderr`.
- Strip control characters from text Jira sent before you print it (`stripControl` in `output.ts`).
