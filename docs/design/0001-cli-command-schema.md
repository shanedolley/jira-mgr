# 0001: CLI Command Schema

**Status:** accepted
**Owner:** @shanedolley
**Refs:** #21

## Problem

`jm` prints only `--help` and `--version` (`apps/cli/src/index.ts`). Stories L2 to L6 (#22 to #26) add about forty commands for people and agents. Q12 requires one command schema to drive `--help`, `jm help --json` and `docs/reference/cli.md`, so the three never drift. Without the schema, the output contract and the exit codes fixed before L2, each story would invent its own flags, output shapes and error handling, and agents would script against a moving target.

## Goals

- One schema, `apps/cli/src/schema.ts`, defines every command in L2 to L6. Later stories write handlers only.
- Commander's tree, `--help`, `jm help --json`, `docs/reference/cli.md` and `docs/reference/errors.md` all derive from that schema and the error table in core. A test or a CI diff fails when any of them drifts.
- Output is a table on a TTY, and JSON when piped or given `--json`, in one envelope for success and failure.
- Exit codes are 0, 2, 3, 4 and 5, plus 1 for `internal`, mapped from `JiraMgrError` and from Commander's own errors.
- No new runtime dependency.

## Design

### Layout

```
apps/cli/src/
  index.ts                 bin entry: run(process.argv.slice(2), nodeIo()), sets process.exitCode
  run.ts                   builds the program, parses, dispatches, maps errors, prints
  schema.ts                CommandSpec types, GLOBAL_OPTIONS, NOUNS and COMMANDS (data only)
  program.ts               buildProgram(specs, handlers, onAction, out): Commander from the schema; helpText
  help.ts                  helpDoc(specs, handlers): the jm help --json document; helpExtras(spec)
  values.ts                one parser per value type, built on zod
  output.ts                envelope, tables, colour, control-character stripping (tree printing and status colour arrive with issue tree in L3)
  context.ts               Context and its factory
  resolve.ts               names to ids: Customer, Engagement, priority, assignee, sprint, link phrase (L4, L5)
  commands/index.ts        HANDLERS registry: command id to handler
  commands/<noun>/<verb>.ts  one handler module per command
```

`schema.ts` holds the whole tree from L1 on. `commands/index.ts` lists only the handlers built so far. A spec without a handler stays out of Commander, `--help`, `jm help --json` and the reference, so nothing documents a command that does not run yet.

### Schema Shape

```ts
type ValueType =
  | 'text' | 'markdown' | 'file' | 'issue-key' | 'id'
  | 'date' | 'datetime' | 'duration' | 'number' | 'integer'
  | 'enum' | 'boolean'

interface ArgSpec {
  name: string                    // kebab-case; the input key is its camelCase form
  type: ValueType
  description: string
  optional?: boolean              // required unless set; optional args follow required ones
  variadic?: boolean              // last arg only; collects into an array
  choices?: readonly string[]     // type 'enum' only
}

interface OptionSpec {
  name: string                    // 'with-subtasks' gives --with-subtasks and input key withSubtasks
  type: ValueType
  description: string
  valueName?: string              // --parent <key>; defaults to the type
  choices?: readonly string[]     // type 'enum' only, matched in any case
  required?: boolean
  default?: string | number | boolean
  repeatable?: boolean            // --label a --label b gives ['a', 'b']
  clearable?: boolean             // the value `none`, in any case, becomes null
  conflicts?: readonly string[]   // other option names
}

interface CommandSpec {
  path: readonly [string, ...string[]]   // ['issue', 'list']; the id is path.join(' ')
  summary: string                        // one line, for parent help and tables
  description?: string                   // longer help; defaults to summary
  args?: readonly ArgSpec[]
  options?: readonly OptionSpec[]
  examples: readonly { command: string; description: string }[]   // at least one
  output: { summary: string; example: unknown }                  // example is the data JSON carries
  exits?: readonly { code: ErrorCode; when: string }[]           // command-specific cases only
  writes: readonly ('jira' | 'state' | 'keychain')[]             // [] for a read
  calls: readonly string[]               // '@jira-mgr/core/write#deleteIssues'
}

const NOUNS: Record<string, string>     // noun to summary, for `jm issue --help`
const GLOBAL_OPTIONS: readonly OptionSpec[]   // [{ name: 'json', type: 'boolean', ... }]
const COMMANDS = [/* ... */] as const satisfies readonly CommandSpec[]
```

`CommandId` is the union of every `path.join(' ')`. `InputOf<Spec>` maps a spec to its handler's input type: `text`, `markdown`, `file`, `issue-key`, `id`, `date`, `duration` and `enum` give `string`, `datetime` gives `Date`, `number` and `integer` give `number`, `boolean` gives `boolean`. `repeatable` and `variadic` wrap it in an array, `clearable` adds `null`, and a value that is neither required nor defaulted adds `undefined`. Handlers therefore get typed input and trust it, per the [TypeScript standard](../standards/typescript.md#validation).

A handler module exports one object:

```ts
interface Handler<S extends CommandSpec, T> {
  run(input: InputOf<S>, ctx: Context): Promise<T> | T   // T becomes `data` in the envelope
  render(data: T, tty: Tty): string                  // the TTY form; '' prints nothing
}

interface Context {
  http(): HttpClient           // created on first use, so help, auth and timer status skip the Keychain
  me(): Promise<CurrentUser>   // L2, with getCurrentUser: memoised; only commands using `me` call it
  io: Io                       // stdout, stderr, readStdin(), isTTY flags, columns, env, signal
  now(): Date
  signal: AbortSignal          // aborted on SIGINT, passed to every core call that takes one
  keychain?: Keychain          // tests inject a fake; auth commands use it
  json: boolean                // the envelope is on, which `help` reads
  specs: readonly CommandSpec[]   // the specs and handlers this run knows, which `help` reads
  handlers: HandlerMap
}
```

L1 ships `Context` without `me()`, because `getCurrentUser` is an L2 core addition.

`run(argv, io, deps?)` takes optional `deps: { http?, keychain?, now?, specs?, handlers? }`. Production passes none; tests inject a fixed-credential client, a fake Keychain and test-only commands.

### Value Types

`values.ts` gives each type one zod schema, used as Commander's `argParser`. A parse failure throws Commander's `InvalidArgumentError`, which exits 2.

| Type | Accepts | Handler gets |
|---|---|---|
| `text` | Any non-empty string | The string |
| `markdown` | Markdown text | The string; the handler calls `markdownToAdf` |
| `file` | A path, or `-` for stdin. At most one option per command takes `-` | The path; the handler reads it |
| `issue-key` | `PSAPAC-12` in any case | `PSAPAC-12` |
| `id` | Digits, such as `10042` | The string |
| `date` | `YYYY-MM-DD`, a calendar date with no zone | The string |
| `datetime` | ISO 8601 with an offset or `Z`, or `YYYY-MM-DD HH:mm` and `YYYY-MM-DDTHH:mm` in the machine's local zone (`TZ` applies) | A `Date`; core sends UTC |
| `duration` | Jira units `w`, `d`, `h`, `m`, spaced or not: `1h30m`, `1h 30m`, `90m`. Decimals are refused | Jira's spaced form, `1h 30m` |
| `number` | A decimal of 0 or more | A number |
| `integer` | A whole number of 1 or more | A number |
| `enum` | One of `choices`, in any case | The choice as the schema spells it |
| `boolean` | The flag's presence | `true` |

Output times follow core: UTC ISO strings in JSON, and local `YYYY-MM-DD HH:mm` on a TTY.

### Commander

`buildProgram` walks the specs that have handlers:

1. The root is `new Command('jm')` with `.version(pkg.version)`, `.helpCommand(false)`, `.exitOverride()`, `GLOBAL_OPTIONS` (so `jm --json issue list` works as well as `jm issue list --json`), and `.configureOutput()` routing help to the `out` argument and silencing Commander's own error printing, since `run` prints errors. `out` carries the help writers, the width and the colour choice, so `help` can capture Commander's text.
2. Each `path` prefix becomes a parent command described from `NOUNS`. The last segment is the leaf, with `.summary()`, `.description()`, one `.argument()` per arg (`<key>`, `[key]`, `<file...>`) and one `new Option()` per option plus `GLOBAL_OPTIONS`. `required` maps to `.makeOptionMandatory()`, `choices` to `.choices()`, `default` to `.default()`, `conflicts` to `.conflicts()`, `repeatable` to a collecting parser.
3. `.addHelpText('after', helpExtras(spec))` appends Examples, Output and Exit codes, rendered from the spec. Commander writes the rest of `--help` from the same spec fields.
4. `.action()` hands the parsed values, renamed to `InputOf<Spec>` keys, to `run`.

`allowExcessArguments` is already `false` in Commander 15, so a stray argument exits 2.

### Help

`jm help [command...] [--json]` is itself a spec, `help`, with a handler from L1. Without `--json` on a TTY it prints Commander's help for that command. With `--json`, or piped, it prints the help document in the envelope:

```json
{
  "data": {
    "name": "jm",
    "version": "0.1.0",
    "globalOptions": [{ "name": "json", "flag": "--json", "type": "boolean", "description": "..." }],
    "exitCodes": [
      { "exit": 0, "code": null, "meaning": "Success" },
      { "exit": 2, "code": "validation_failed", "meaning": "...", "fix": "..." }
    ],
    "commands": [
      {
        "id": "issue delete",
        "usage": "jm issue delete <keys...> [--confirm] [--with-subtasks]",
        "summary": "...", "description": "...",
        "args": [], "options": [], "examples": [],
        "output": { "summary": "...", "example": { "key": "PSAPAC-12", "deletedSubtasks": [] } },
        "exits": [{ "code": "validation_failed", "exit": 2, "when": "--confirm is missing" }],
        "writes": ["jira"], "calls": ["@jira-mgr/core/state#assertInProject", "@jira-mgr/core/write#deleteIssues"]
      }
    ]
  }
}
```

Each option entry carries `flag`, `type`, `valueName`, `required`, `default`, `repeatable`, `clearable`, `choices` and `conflicts`. `jm help issue delete --json` prints the one command object. An unknown command exits 2.

`exitCodes` comes from `EXIT_CODES` and a new `ERROR_HELP: Record<ErrorCode, { meaning: string; fix: string }>` beside it in `packages/core/src/errors.ts`. The `Record` type makes a new code without help text fail the typecheck.

### Reference

`scripts/gen-reference.ts` runs the built binary, `node apps/cli/dist/index.js help --json`, and renders two files from `data`:

- `docs/reference/cli.md`: global options, the envelope, the exit codes, then a `##` section per noun and a `###` section per command with usage, description, an arguments table, an options table (flag, type, required, default, description), examples, the output example, command-specific exits, writes and core calls.
- `docs/reference/errors.md`: one row per code with its exit code, meaning and fix.

Reading the binary's JSON, not importing `schema.ts`, keeps scripts from importing across packages and lets Node's type stripping run the script, which cannot follow the CLI's `.js` import specifiers. The reference also documents exactly what agents receive.

Root `package.json` gains `"docs:reference": "pnpm --filter @jira-mgr/cli build && node scripts/gen-reference.ts"`. `docs/` is in `.prettierignore`, so generated tables need no formatting pass. `pnpm ci:local` (the route that replaced the `checks` job of GitHub CI) runs, after `pnpm build`, `pnpm docs:reference && git diff --exit-code -- docs/reference`.

`docs/reference/core.md` (TypeDoc) stays out of L1: it needs a new dev dependency and nothing waits on it. Shane dropped it on 2026-10-10, so the package README is the core reference.

### Output

**Mode.** JSON mode is on when `--json` is in argv (before any bare `--`) or `stdout` is not a TTY. `run` decides before parsing, so a Commander error also prints JSON when piped. `--help` and `--version` always print plain text.

**Envelope.** stdout carries exactly one JSON value:

| Case | stdout |
|---|---|
| Success | `{"data": <result>}` |
| Failure | `{"error": {"code": "...", "message": "...", "details": ...}}` |

`details` is `JiraMgrError.details` after a JSON round trip, omitted when undefined. Core already fills it with what an agent acts on: `{ status, errorMessages, errors }` from Jira, `available` statuses, `runningIssueKey` and `expectedIssueKey`, the timer's `draft`, `timer` and `restored`, a state file's `path` and `issues`. `cause` never prints. Core puts no token in `details`, and `run` adds nothing to it. JSON is compact when piped and indented two spaces when `--json` is given on a TTY.

**TTY.** `render` writes the result to stdout. Errors go to stderr as `jm: <message>` and nothing goes to stdout. An empty list prints nothing to stdout and `No issues match.` (or the noun's equivalent) to stderr.

**Markdown.** Descriptions and comments print as Markdown on a TTY, unrendered. JSON carries the raw ADF in `description` and `body`, as the grilling record decides, plus `descriptionMarkdown` and `bodyMarkdown` from `adfToMarkdown`, because an agent's piped output is always JSON and would otherwise never see Markdown. Input is Markdown through `--description`, `--body` or `--comment`, from a file or stdin through `--description-file` and `--body-file`, or raw ADF through `--adf <file>`. Each command's description inputs conflict with each other. Core validates `--adf` with `adfDocSchema`.

**Tables.** `output.ts` pads columns with two spaces and a bold header, with no dependency. `jm issue list` shows `KEY TYPE STATUS ASSIGNEE CUSTOMER SUMMARY`. ASSIGNEE truncates at 20 characters and CUSTOMER at 24, and SUMMARY takes what remains of `stdout.columns` (100 when unknown), with a minimum of 20. Truncation ends in `…`.

**Tree.** Arrives in L3 with `issue tree`. It prints two spaces per level:

```
Acme Corp
  PSAPAC-100  Epic     In Progress  Data migration
    PSAPAC-120  Story    To Do        Build the loader  [Customer: Beta Ltd, Epic: Acme Corp]
      PSAPAC-121  Subtask  In Progress  Write the tests
    +3 done
  No Epic
    PSAPAC-130  Story    Review       Fix the login
No Customer
  ...
```

Type pads to 7 characters and status to the longest status shown. A context-only row is dimmed, or suffixed ` (context)` without colour. A Done chip reads `+N done`. JSON is core's `CustomerGroup[]` unchanged.

**Colour.** `util.styleText` from Node, with `NO_COLOR`, `FORCE_COLOR` and the stream's TTY state decided in `output.ts`. L1 ships the `paint` helper; status colour arrives with the tables in L3. Status colour follows the status category: none for to do, blue for in progress, green for done. A mismatch is yellow, and the `jm:` error prefix red. JSON never carries colour.

**Control characters.** On a TTY, `output.ts` strips C0 and C1 control characters except newline and tab from every string it prints, so Jira text cannot drive the terminal. JSON escapes them already.

**Streams.** stdout holds the result only. stderr holds progress (`Loaded 300 issues`, only when stderr is a TTY), warnings and TTY-mode errors. `JM_DEBUG=1` adds core's request lines and, for `internal` errors, the stack.

### Exit Codes

| Exit | Code | Raised by |
|---|---|---|
| 0 | | Success, `--help`, `--version`, an idempotent no-op |
| 1 | `internal` | Any error that is not a `JiraMgrError` or a Commander error. Message: `Unexpected error: <message>. Run with JM_DEBUG=1 for the stack.` |
| 2 | `validation_failed` | Every Commander error: `unknownOption`, `unknownCommand`, `missingArgument`, `optionMissingArgument`, `missingMandatoryOptionValue`, `invalidArgument`, `conflictingOption`, `excessArguments`, and `commander.help` (a noun with no verb, or bare `jm`) |
| 3 | `not_found` | |
| 4 | `permission_denied` | Includes "Not logged in" |
| 5 | `jira_error` | |
| 130 | | Ctrl-C: the signal aborts core calls, and nothing prints to stdout. A command that writes state, and `issue create`, first settle (at most 10 seconds) and print their error message to stderr |

`JiraMgrError` maps through `EXIT_CODES`. Commander's `commander.helpDisplayed` and `commander.version` exit 0. An `EPIPE` on stdout, as when piping to `head`, exits 0 silently. `docs/standards/errors-and-logging.md` gains the success envelope and the 1 and 130 rows in L1.

### Safety

- **Delete.** `jm issue delete <key>` without `--confirm` exits 2 before any request: `Deleting PSAPAC-12 is permanent. Pass --confirm.` With `--confirm`, it reads the issue's subtasks through `getIssue`. With subtasks and no `--with-subtasks`, it exits 2 with `PSAPAC-12 has subtasks PSAPAC-13, PSAPAC-14. Pass --with-subtasks to delete them too.` and `details.subtasks`. Otherwise it calls `deleteIssue` with `deleteSubtasks` set to whether the flag was given (Q9).
  *Amended 2026-10-20, build of #339.* The command takes several keys (`<keys...>`) and calls core's `deleteIssues`, which reads each issue and deletes them one at a time, lowest level first (Subtasks, then Stories, Tasks and Bugs, then Epics). Every key is checked against the project and `--confirm` before any request. One key keeps its output and exit codes. Several keys return `{ deleted: [{ key, deletedSubtasks }], failed: [{ key, error: { code, message } }] }`, `deleted` in the order they were deleted; a failed key does not stop the rest, and the exit code is the first failure's (0 when none failed). Each key goes to stderr as it settles ("Deleted KEY ...", "Could not delete KEY: message"), so a Ctrl-C part way still says what went; a terminal then prints only "Deleted N issues, M failed" on stdout. A key repeated counts once.
- **No other guard** (Q3 a). Every other command, status changes included, runs for any caller. Comment, worklog, link and attachment deletes need no `--confirm`.
- **Token.** No flag carries the token, since argv shows in `ps`. `jm auth login` reads it from a hidden TTY prompt, or from stdin with `--token-stdin`.
- **Prompts.** Only `jm auth login` prompts, and only on a TTY, for a missing site, project, email or token. Every other command exits 2 naming the missing value, on a TTY or not. This replaces the CLI README's rule that every command prompts.
- **Views.** `--view` takes an id or a name in any case through `findView`: `--view my-issues` or `--view "My issues"`. An unknown view exits 3. The CLI only reads `views.json`.
- **Timer guard.** `--expect <key>` passes `expectRunning` to core: the command refuses when a different issue's timer runs, and proceeds when none runs. `jm timer stop --time` needs `--expect`, as core requires. A draft with `needsConfirmation` (over the threshold, or across midnight) makes `jm timer stop` and a switching `jm timer start` exit 2 with the draft in `details`, unless `--confirm` logs it as is or `--time` (with `--expect`) replaces it (Q55).
- **Names.** Customer, Engagement and priority accept a name in any case or an option id, matched against `getFieldOptions`. An unknown or ambiguous name exits 2 listing the choices. `--assignee` accepts `me`, an account id, or a query that `searchAssignableUsers` matches to exactly one user.

### Idempotence

What an agent can rely on:

| Command | Repeated or redundant call |
|---|---|
| Every read | Safe |
| `jm status set` to the current status | Exits 0 with `changed: false` and sends no transition |
| `jm issue edit` with the current values | Jira accepts it; nothing changes |
| `jm sprint set` to the issue's sprint | Jira accepts it |
| `jm auth logout` | Exits 0 when already logged out |
| `jm timer start` on the running issue | No-op; a paused timer resumes |
| `jm timer stop` with no timer | Exits 0 with `data: null` |
| `jm timer pause` or `resume` | No-op when already paused or running; exits 3 with no timer |
| A delete or remove of something gone | Exits 3 |
| `issue create`, `comment add`, `worklog add`, `attach add`, `link add` | Not idempotent: each call adds another |

A write that fails with `jira_error` or `internal` after the request left may have gone through, and core's message says so. Re-read before retrying a non-idempotent write.

### Commands

Every command also takes `--json`. Types follow the value types table. `R` marks a required option. Arguments are required unless shown in brackets.

#### auth (L2)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm auth login` | `--site <url>`, `--project <key>`, `--email <text>` (each defaults to settings, else prompts on a TTY, else exits 2); `--token-stdin` | `auth#login` | state, keychain | `{ siteUrl, projectKey, email, accountId, displayName }` |
| `jm auth status` | none | `auth#getCredentials`, `state#readFields`, `lookups#getCurrentUser` | none | `{ siteUrl, projectKey, email, accountId, displayName, fieldsResolvedAt }`; exits 4 when logged out |
| `jm auth logout` | none | `auth#logout` | keychain, state | `{ loggedOut: true }` |

*Amended 2026-10-07, review of L2:* `login` no longer calls `lookups#getCurrentUser`. Core `login` returns the account from its own verify request, so the command makes one `/myself` call and cannot fail after it has stored the login.

#### issue (L3, L4)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm issue list` | `--view <id-or-name>`; `--search <text>`; repeatable `--assignee <me\|unassigned\|account-id>`, `--status <name-or-id>`, `--label <text>`, `--type <name-or-id>`, `--sprint <id\|name\|current>`; `--mine`; `--show-done`; `--limit <integer>` | `state#findView`, `search#searchIssuePages`, `view-filter#issueMatcher` | none | `Issue[]` |
| `jm issue tree` | The `issue list` filters except `--limit`, plus `--show-empty-customers` | as `list`, plus `hierarchy#buildHierarchy`, `lookups#getFieldOptions` | none | `CustomerGroup[]` |
| `jm issue get <key>` | none | `search#getIssue`, `adf#adfToMarkdown` | none | `Issue` plus `description` (ADF or null), `descriptionMarkdown`, `subtasks: { key, summary, status }[]`, `url` |
| `jm issue create` | `--type <enum: Epic Story Task Bug Subtask>` (default Story); R `--summary <text>`; R `--customer <name-or-id>`; R `--engagement <name-or-id>`; `--parent <key>`; `--description <markdown>` \| `--description-file <file>` \| `--adf <file>`; `--assignee <me\|account-id\|query>`; `--priority <name-or-id>`; repeatable `--label <text>`; `--start <date>`; `--due <date>`; `--estimate <duration>`; `--time-remaining <number>` | `write#createIssue`, `search#getIssue`, `lookups#getFieldOptions`, `lookups#searchAssignableUsers`, `adf#markdownToAdf` | jira | As `jm issue get`, read back after the create |
| `jm issue edit <key>` | `--summary`; the three description inputs or `--clear-description`; clearable `--assignee`, `--start`, `--due`, `--time-remaining`; `--priority`; repeatable `--label` (replaces), conflicting with repeatable `--add-label` and `--remove-label`; `--parent <key>` (the CLI does not copy Customer or Engagement from the new parent; Q16's question is the app's dialog); `--customer`; `--engagement`; `--estimate <duration>`; `--type <enum: Story Task Bug>` (only a Story, Task or Bug can change, read through `getIssue` first) | `search#getIssue` (for `--type`), `write#editIssue` and the create lookups | jira | `{ key, changed: string[] }` (the option names sent, each once: `label` stands for `--label`, `--add-label` and `--remove-label`, and `description` for the four description options) |
| `jm issue delete <keys...>` | `--confirm`; `--with-subtasks` | `state#assertInProject`, `write#deleteIssues` | jira | `{ key, deletedSubtasks: string[] }`, or with several keys `{ deleted, failed }` |

*Amended 2026-10-09, #67 (approved on #27):* `issue create` reads the new issue back through `createIssue`, which returns it, so `data` is the object `issue get` returns and shows what the PSAPAC automation changed. If the read fails after the create, the command exits 5 with `jira_error`, a message that says the issue exists, and `details: { key, id }`. No new error code. `createIssue` takes `{ signal }` and the handler passes `ctx.signal`, so Ctrl-C during the read-back wraps the abort in that same error and `run` prints it to stderr before exiting 130, which keeps the key. A Ctrl-C before the POST creates nothing and prints nothing. The settle wait in `run` covers a command that writes `state` and a handler that sets `settlesOnInterrupt` (only `issue create`). It does not cover other Jira writes: most pass no signal, so their request would run to the end and the wait would only delay the exit. Passing a signal through the other writes is a later change. `settlesOnInterrupt` lives on the handler, not the spec, so it is not in `jm help --json`.

Filters for `list` and `tree`:

- Toggles start at `hideDone: true`, `assigneeMe: false`, `hideEmptyCustomers: true`. A view's toggles replace them, and `--show-done`, `--mine` and `--show-empty-customers` turn one on. The CLI ignores `settings.toggles`, which hold the app's last UI state, so the same command gives the same answer whatever the app last showed.
- A view's filters apply first. Each filter flag replaces that field's list, and `--search` replaces `text`.
- With `hideDone` on, the handler stops `searchIssuePages` after the `unresolved` phase, which halves the requests. `issue tree` then has no Done issues to count, so it prints no Done chips; `--show-done` loads both phases. An `epic` or `not.epic` filter loads both phases to climb from a Subtask even with `hideDone` on, yet `buildHierarchy` builds from the open issues alone, so the tree still prints no Done chip and no Done row (#199). The `+N done` chip shows only with `--show-done` or a view with `hideDone` off.
- `--mine`, and any `me` assignee value, calls `ctx.me()` once for the account id.
- `--limit` stops paging once that many issues match.

#### status (L4)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm status set <key> <status>` | Status name in any case, or id | `search#getIssue`, `write#transitionIssue` | jira | `{ key, status, changed }` |

#### comment (L5)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm comment list <key>` | none | `extras#listComments` | none | `IssueComment[]` plus `bodyMarkdown` |
| `jm comment add <key>` | One of `--body <markdown>`, `--body-file <file>`, `--adf <file>` | `extras#addComment` | jira | the comment |
| `jm comment edit <key> <comment-id>` | As `add` | `extras#editComment` | jira | the comment |
| `jm comment delete <key> <comment-id>` | none | `extras#deleteComment` | jira | `{ key, commentId }` |

#### worklog (L5)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm worklog list <key>` | none | `extras#listWorklogs` | none | `Worklog[]` |
| `jm worklog add <key>` | R `--time <duration>`; `--started <datetime>`; `--comment <markdown>` | `extras#addWorklog` | jira | the worklog |
| `jm worklog edit <key> <worklog-id>` | `--time`, `--started`, `--comment`; at least one | `extras#editWorklog` | jira | the worklog |
| `jm worklog delete <key> <worklog-id>` | none | `extras#deleteWorklog` | jira | `{ key, worklogId }` |

#### link (L3, L5)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm link types` | none | `extras#listLinkTypes` | none | `LinkType[]` |
| `jm link list <key>` | none | `extras#listLinks` | none | `IssueLink[]` |
| `jm link add <key> <phrase> <other-key>` | none | `extras#listLinkTypes`, `extras#addLink`, `extras#listLinks` | jira | `{ id, type, direction, key, otherKey }` |
| `jm link remove <link-id>` | none | `extras#removeLink` | jira | `{ linkId }` |

`link add` reads as a sentence: `jm link add PSAPAC-1 blocks PSAPAC-2`, `jm link add PSAPAC-1 "is blocked by" PSAPAC-2`. The phrase matches, in any case, a type's name or outward text (direction `outward`) or its inward text (`inward`). A phrase matching more than one type exits 2 listing them. After the add, `listLinks` finds the new link's id.

*Amended 2026-10-07, review of L5:* A type's name, in any case, now matches before any phrase and reads `outward`, because type names are unique while phrases are not: "Causes" is Causes' name and Problem/Incident's outward text, so matching them equally made `jm link add A Causes B` impossible. Phrases still match outward text (`outward`) and inward text (`inward`) for the other cases. An inward phrase two types share, such as "is caused by", exits 2 naming the types; the way out is the type name with the two issues swapped.

#### attach (L5)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm attach list <key>` | none | `extras#listAttachments` | none | `Attachment[]` |
| `jm attach add <key> <file...>` | none | `extras#addAttachment` | jira | `Attachment[]` |
| `jm attach remove <attachment-id>` | none | `extras#removeAttachment` | jira | `{ attachmentId }` |

#### sprint (L3, L5)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm sprint list` | `--all` | `sprints#findBoard`, `sprints#listSprints` | none | `Sprint[]` |
| `jm sprint set <sprint> <key...>` | `<sprint>` is an id, a name in any case, `current` or `backlog`; 1 to 50 keys | `sprints#listSprints`, `sprints#moveToSprint`, `sprints#moveToBacklog` | jira | `{ sprint: { id, name } \| null, keys }` |

Without `--all`, `sprint list` shows the active sprint and dated future sprints (Q20). `--all` adds closed and undated ones. `current` with more than one active sprint exits 2 listing them.

#### field and view (L3)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm field options <field>` | `<field>` is `customer`, `engagement`, `priority`, `issue-type` or `status` | `lookups#getFieldOptions` | none | `{ id, name }[]` |
| `jm view list` | none | `state#readViews` | none | `SavedView[]` |

#### timer (L6)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm timer start <key>` | `--expect <key>`; `--confirm` | `search#getIssue`, `timer#switchAndLog` | state, jira (when switching) | `{ timer, stopped, logged }` |
| `jm timer stop` | `--comment <markdown>`; `--time <duration>` (needs `--expect`); `--expect <key>`; `--confirm`; `--discard` (conflicts with `--comment`, `--time`, `--confirm`) | `timer#stopAndLog`, `timer#stopTimer` | state, jira | `{ draft, worklog }`, `{ draft, worklog: null }` with `--discard`, or `null` when idle |
| `jm timer status` | none | `state#readTimer`, `state#readSettings`, `timer-calc#worklogDraft` | none | `{ issueKey, state: 'running' \| 'paused', elapsedSeconds, draft }` or `null` |
| `jm timer pause` | none | `timer#pauseTimer` | state | as `status` |
| `jm timer resume` | none | `timer#resumeTimer` | state | as `status` |

`timer start` reads the issue for its type, then reads the timer and computes its draft to apply the confirmation rule before calling `switchAndLog`.

#### help (L1)

| Command | Arguments and options | Calls | Writes | Data |
|---|---|---|---|---|
| `jm help [command...]` | none | none | none | The help document, or one command |

### Core Additions

The CLI needs four small, additive core changes, each in the story that first uses it:

| Story | Change |
|---|---|
| L1 | `ERROR_HELP` in `packages/core/src/errors.ts` |
| L2 | `getCurrentUser(http)` in `@jira-mgr/core/lookups`: `GET /rest/api/3/myself` to `{ accountId, displayName }`, with a recorded `myself` fixture. `./test/msw` added to core's `exports`, pointing at `test/msw.ts`, so CLI tests share the fake |
| L3 | `getIssue(http, key)` in `@jira-mgr/core/search`: one issue with `description` (ADF or null) and `subtasks`, with a recorded fixture |

*Amended 2026-10-07, review of L2:* core `login` now returns `CurrentUser` (`{ accountId, displayName }`). Core's `exports` also gains `./test/setup`, the shared Vitest setup file that starts the MSW fake.

*Amended 2026-10-07, build of L3:* `getIssue(http, key, { signal })` returns the issue's fields plus `description` (an ADF document or `null`) and `subtasks` (`{ key, summary, status }`, the status as its name). `searchIssuePages` gains `phases`, because the generator fetches a phase's first page before the caller can stop it: a caller that hides Done passes `['unresolved']` and sends no request for Done issues. `issue list` and `issue tree` therefore load with `phases`, not by stopping the generator. `issue get` builds `url` from the site in settings. Their `validation_failed` exit now reads "A state file, such as the saved views, is invalid", because filter flags match issues client-side and do not resolve names. `sprint list` exits 3 when the project has no board that supports sprints, and hides a future sprint with neither a start nor an end date unless `--all`.

*Amended 2026-10-07, build of L4:* `transitionIssue` returns the name of the status reached, so `status set` reports the canonical name whatever the caller typed (a name in any case, or an id) without a second read. `resolve.ts` holds `resolveOption` (Customer, Engagement and priority, by option id or name in any case, an id winning over a name) and `resolveAssignee` (`me`, an account id, or a name that matches exactly one assignable user). An account id is 24 hex digits, or digits, a colon and a UUID, and goes through unsearched. `input.ts` reads `--description-file` and `--adf` (a regular file or `-`, at most 1 MiB, read in a loop so a short read cannot truncate it) and validates raw ADF with core's schema. `site.ts` holds the site check `issue get` and `issue create` share, and the project check. `issue create` checks a Subtask's `--parent` and every name before it sends the create, so a refusal leaves nothing half done. `issue edit` reports `changed` as the CLI option names the caller passed, each once (`summary`, `description`, `assignee`, `priority`, `label`, `due`, `start`, `parent`, `customer`, `engagement`, `estimate`, `time-remaining`, `type`). `issue edit --type` reads the issue first and refuses unless it is a Story, Task or Bug, so an Epic or Subtask never changes type (Q23), and the PUT is not sent on a refusal. `issue edit`, `issue delete` and `status set` refuse a key outside the project in settings with `validation_failed` and no request, because the app manages that project only. `issue create` and `issue edit` apply the same check to `--parent`. With no project in settings, all four exit 4 (`permission_denied`) before any request. `--parent` does not copy Customer or Engagement from the new parent. Stdin is read through `readStdin(maxBytes)`, which stops past the limit: 1 MiB for descriptions, 4096 bytes for `auth login --token-stdin`. `--label` sets at least one label, so it cannot empty the list; use `--remove-label`.

*Amended 2026-10-07, build of L5:* `resolve.ts` gains `resolveLink` (a phrase to a link type and direction: a type's name or outward text reads outward, its inward text reads inward, and an unknown or ambiguous phrase exits 2) and `resolveSprint` (an id, a name in any case or `current`, matched among the active and future sprints only, with an id winning over a name). An unknown sprint exits 2 listing the choices, as the schema's `exits` say, since a name that matches nothing is a validation failure like an unknown Customer. `sprint set` reads the board first, so its `calls` gain `findBoard` and its `exits` gain `not_found` for a project with no sprint board. Every command that writes to an issue key refuses a key outside the project in settings, before any request: `comment add`, `edit` and `delete`, `worklog add`, `edit` and `delete`, `attach add`, `sprint set` (each key), and `link add` (both keys). `attach remove` takes no issue key and nothing in core reads an attachment's issue, so it cannot be checked and relies on Jira's permissions. `comment add` and `edit` return the comment as Jira sends it, without `bodyMarkdown`, as their output examples show; `comment list` adds `bodyMarkdown`. `link add` finds the new link's id as the highest matching id `listLinks` reports afterwards, and the terminal line reads from the phrase the caller gave ("PSAPAC-1 blocks PSAPAC-2"). `attach add` checks every path (a regular file, not `-`) before it uploads any, hands core a file-backed `Blob` so the site's upload limit is checked before the file is read, and uploads in order: a failure after the first upload names the files already attached. `sprint set` refuses more than 50 keys before any request, and `attach add` gains a `validation_failed` exit for refused files.

*Amended 2026-10-07, review of L5:* `link remove` reads the link first (`getLink`, a new core read of `GET /rest/api/3/issueLink/{id}`, recorded as `issue-link-551838`) and refuses it unless both issues are in the project, so only `attach remove` goes unchecked. `link add` says the link was added, and not to run it again, when reading the links back fails. Core gains `addAttachments`, which reads the site's upload limit once, refuses the whole batch before any upload when a file is over it, and names the files already attached when a later upload fails; `addAttachment` calls it with one file. Core's `RequestOptions` gains `timeoutMs`, and each upload gets 30 seconds plus 10 seconds per megabyte, so a large file is not cut off by the 30 second read timeout. The guard's exits (`validation_failed` for a key outside the project, `permission_denied` for no project) are listed on every command that has the guard.

*Amended 2026-10-07, build of L6:* `timer start` has no `--switch`: a timer running on another issue is always logged first, through `switchAndLog`, since the spec already says so. It reads the issue (`getIssue`), refuses a non-timeable type, then reads the running timer and computes its draft with `ctx.now()` to apply the confirmation rule; a long or midnight-crossing draft exits 2 with `details.draft` unless `--confirm`. The check is skipped when `--expect` names another issue, so core's refusal (with `runningIssueKey` and `expectedIssueKey`) wins, and when the timer already runs on the issue, since nothing is logged. `start` returns `stopped` as the old timer's draft and `logged` as the worklog it created, so the draft is not repeated. `timer stop` applies the same rule before `stopAndLog`: `--confirm` or `--time` lifts it, and core refuses `--time` without `--expect`. `timer status`, `pause` and `resume` return `{ issueKey, state, elapsedSeconds, draft }` from the settings' rounding and read no credentials. Core now holds two rules the CLI relies on. First, `stopAndLog` and `switchAndLog` take `confirm` and refuse an unconfirmed draft under the lock, so the CLI's own check only gives the friendly message and the clock cannot pass midnight between the two; `--time` counts as confirming. Second, they take `signal`, so Ctrl-C fails the worklog request and the timer comes back paused; `run` waits (at most 10 seconds) for a command that writes state to settle before it returns 130, because `bin` exits at once after 130 and would cut off the restore. A start that is refused for confirmation names three ways on: `--confirm`, `jm timer stop --time <duration> --expect KEY` and `jm timer stop --discard`. Ctrl-C prints what the restore said (such as `The timer is paused on KEY; stop the timer again.`) to stderr and still exits 130. The CLI has no pre-check of its own: it words core's refusal of an unconfirmed draft with the CLI's flags and local time. Known limit: a SIGKILL, a power loss, or a second Ctrl-C during the restore, between the timer being taken off `timer.json` and the log finishing, still loses the time (C12's design). `status` carries no reminder flag: reminders belong to the app, which alone knows when it last notified (Q55).

### Testing

**In-process.** CLI tests call `run(argv, io, deps)` from `apps/cli/src/run.ts` with a fake `io` (string buffers, `stdoutIsTTY` and `stderrIsTTY` flags, `columns`, `env` with `NO_COLOR`) and read the exit code, stdout and stderr. Handler tests sit beside their handler as `<verb>.int.test.ts`, start the MSW server from `@jira-mgr/core/test/msw`, call `usePsapacState()`, and inject `createHttpClient({ credentials, sleep })` so no test touches the Keychain or waits. They assert the requests core sent (`serveRecorded`), the envelope, and the exit code. `argv` never holds pnpm's `--`.

**Binary.** `apps/cli`'s `test` script becomes `tsup && vitest run`, so the bundle exists before its smoke tests and CI needs no reordering. `bin.test.ts` spawns the bundle with no Jira: through `node scripts/jm.ts -- --version`, covering the `--` strip; `help --json`, which must equal the in-process document; and `nope`, which must exit 2 with the error envelope. Handler tests stay in-process, because MSW cannot intercept a child process and core refuses any site but `https://<name>.atlassian.net`. `docs/standards/testing.md` changes its CLI row to match in L1.

**Shape.** `expectShape` arrives in L2, with the first handler tests. Each handler test calls `expectShape(json.data, spec.output.example)`, which checks that the keys match recursively, using the first element of an array. The example in the schema then cannot drift from what the handler returns.

**L1 tests:**

| File | Test |
|---|---|
| `schema.test.ts` | `every command path is unique` |
| | `option and argument names are kebab-case and unique within a command, globals included` |
| | `enum values carry choices and only enum values do` |
| | `optional arguments follow required ones and only the last is variadic` |
| | `conflicts name options of the same command` |
| | `every exit names a known error code` |
| | `every example starts with jm and the command path and parses without error` |
| | `every command has a summary, an output example and at least one example` |
| `program.test.ts` | `the Commander tree holds exactly the commands with handlers` |
| | `each leaf's flags equal its spec's options plus the global options` |
| | `--help prints the summary, every flag, every example and the exit codes` |
| | `a spec without a handler is absent from help` |
| `help.test.ts` | `help --json lists the commands with handlers` |
| | `help with a command path prints that command only` |
| | `help for an unknown command exits 2` |
| | `exit codes list every error code with its meaning and fix` |
| `run.test.ts` (test-only command injected through `deps`) | `each JiraMgrError code exits with its mapped code` |
| | `each Commander error exits 2 with validation_failed` |
| | `--help and --version exit 0` |
| | `bare jm and a noun with no verb exit 2` |
| | `a non-JiraMgrError exits 1 as internal without a stack` |
| | `JM_DEBUG=1 prints the stack of an internal error to stderr` |
| | `piped output is the JSON envelope` |
| | `--json on a TTY prints indented JSON` |
| | `a TTY failure prints jm: message to stderr and nothing to stdout` |
| | `a piped failure prints the error envelope to stdout` |
| | `details pass through and cause never prints` |
| | `an aborted signal exits 130` |
| | `EPIPE on stdout exits 0` |
| `values.test.ts` | `issue keys normalise to upper case and refuse PSAPAC-0` |
| | `durations accept 1h30m and print 1h 30m, and refuse 1.5h` |
| | `datetimes read an offset, Z and local time` |
| | `dates refuse anything but YYYY-MM-DD` |
| | `enums match in any case and return the schema spelling` |
| | `clearable values turn none into null` |
| `output.test.ts` | `tables pad columns and truncate the summary to the width` |
| | `no colour without a TTY or with NO_COLOR` |
| | `control characters are stripped on a TTY` |
| `bin.test.ts` | `pnpm's -- is dropped before the CLI sees it` |
| | `the bundle's help --json equals the in-process document` |
| | `an unknown command exits 2 with the error envelope` |

The `git diff --exit-code -- docs/reference` step of `pnpm ci:local` proves the committed reference matches the schema.

**Handler tests, L2 to L6.** Each command gets a success test asserting the requests sent and the envelope, one TTY render test, and a test per row of its `exits`. Beyond those:

- auth: `login reads the token from stdin with --token-stdin`; `login without a TTY or --token-stdin exits 2 naming the token`; `status exits 4 when logged out`; `logout exits 0 when logged out`.
- issue list and tree: `--view resolves an id and a name in any case`; `an unknown view exits 3`; `a filter flag replaces the view's field`; `hidden done skips the done phase`; `--show-done loads both phases`; `--limit stops paging`; `--mine asks for the current user once`; `settings toggles are ignored`; `the tree prints mismatches, context rows and Done chips`.
- issue get: `JSON carries the ADF and the Markdown description`; `an unknown key exits 3`.
- issue create and edit: `Customer and Engagement resolve by name in any case`; `an unknown or ambiguous name exits 2 listing choices`; `Markdown becomes ADF`; `two description inputs exit 2`; `none clears the assignee, dates and time remaining`; `--label conflicts with --add-label`; `an edit with nothing to change exits 2`.
- issue delete: `without --confirm nothing is sent`; `subtasks without --with-subtasks exit 2 naming them`; `--with-subtasks sends deleteSubtasks=true`.
- status set: `the current status sends no transition`; `an unreachable status exits 2 listing the available ones`.
- link add: `blocks reads outward`; `is blocked by reads inward`; `a type name reads outward`; `an ambiguous phrase exits 2`; `the new link's id is returned`.
- sprint: `list hides undated future sprints without --all`; `set backlog moves to the backlog`; `set current with two active sprints exits 2`.
- timer: `start refuses an Epic`; `start logs the running timer before switching`; `stop logs the draft`; `stop --discard logs nothing`; `stop with no timer exits 0 with null`; `stop --time without --expect exits 2`; `a draft needing confirmation exits 2 without --confirm`; `--expect naming another issue exits 2`; `pause with no timer exits 3`; `a failed worklog keeps the timer paused and exits with core's code`.

## Alternatives

| Option | For | Against |
|---|---|---|
| **Declarative specs, Commander built from them** (chosen) | Plain data that `help --json` serialises as it stands; Commander mapping is a short loop; per-type zod parsers validate at the boundary | Cross-field rules beyond `conflicts` live in handlers or core |
| Zod input schemas converted to JSON Schema, Commander built from that | One schema both validates and documents; JSON Schema suits agents | Arguments, short flags and examples need metadata zod does not hold; walking JSON Schema into Commander is more code than the specs it replaces |
| Hand-written Commander, help scraped for the reference | No schema to maintain | The drift Q12 forbids |
| Spec beside each handler in `commands/<noun>/<verb>.ts` | Spec and code in one file | L1 could not fix the full tree without stub handlers, and stubs would leak into help |
| Bare JSON on success, no `data` key | Shorter `jq` paths | Nothing can sit beside the result later without breaking scripts, and an agent tells success from failure by guessing at the shape |
| `gen-reference.ts` imports `schema.ts` | No build needed | A relative import across packages, and Node's type stripping cannot follow `.js` specifiers |
| CLI tests spawn the bundle with MSW preloaded into the child | Exercises the real binary | Needs a preload that rebuilds handlers from a file per test; slower; in-process `run()` covers the same code |
| Server-side JQL for list filters | Fewer pages for narrow filters | A second filter semantics beside core's `view-filter`, which the app shares |

## Rollout

| Story | Ships |
|---|---|
| L1 (#21) | `schema.ts` with every command; `program.ts`, `run.ts`, `help.ts`, `values.ts`, `output.ts` (envelope, tables, colour, control characters), `context.ts` (without `me()`); the `help` handler; `ERROR_HELP`; `scripts/gen-reference.ts` and `pnpm docs:reference`; generated `cli.md` and `errors.md`; the CI drift step; updates to `docs/reference/README.md` (`errors.md` becomes generated), `AGENTS.md` (generated files, core.md deferred), `apps/cli/README.md` (prompt rule, layout), `scripts/README.md`, and the testing and errors standards |
| L2 (#22) | auth handlers, `getCurrentUser` and `ctx.me()`, the core test export, `expectShape` |
| L3 (#23) | issue list, tree and get; field options; view list; link types; sprint list; `getIssue`; tree printing and status colour in `output.ts` |
| L4 (#24) | issue create, edit and delete; status set; `resolve.ts` |
| L5 (#25) | comment, worklog, link (list, add, remove), attach, sprint set |
| L6 (#26) | timer |
| L7 (#27) | A smoke checklist in `docs/runbooks/` with one line per command in `cli.md`, run against PSAPAC |

Each story adds handlers to `commands/index.ts` and regenerates the reference. A spec change after L1 is a public contract change and goes to Shane first, per `AGENTS.md`. `jm` has no users beyond Shane yet, so backing out is a revert of the story's pull request.

## Open Questions

None remain open. Shane answered all four on 2026-10-07, each with the recommended option, and the design above carries the answers:

- **Envelope.** Success prints `{"data": ...}` and failure prints `{"error": {...}}`, not a bare result.
- **Additions to Q32.** `jm comment list`, `jm worklog list`, `jm link list` and `jm attach list` show the ids that edit and remove need. `jm view list` shows view ids, and `jm sprint set` takes `backlog`.
- **Long timers.** A `jm timer stop`, or a switching `jm timer start`, whose draft needs confirmation (past the threshold or across midnight) exits 2 unless `--confirm` or `--time` is given. This applies Q55 to the CLI on top of Q51.
- **Markdown in JSON.** JSON carries `descriptionMarkdown` and `bodyMarkdown` beside the raw ADF in `description` and `body`.
