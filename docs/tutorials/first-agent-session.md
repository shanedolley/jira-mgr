# First Agent Session

In this lesson an agent reads the issue tree and edits one field through `jm`, using JSON only. Finish [Getting started](getting-started.md) first, so `jm auth status` works. The agent runs in the same repository and calls `pnpm jm -- <args>`.

## Why JSON

When `jm` writes to a pipe, or you pass `--json`, stdout carries exactly one JSON value. A success is `{"data": ...}`. A failure is `{"error": {"code": "...", "message": "..."}}`. The exit code tells the same story: 0 for success, 2 for bad input, 3 for not found, 4 for permission denied, 5 for a Jira failure ([CLI reference](../reference/cli.md#envelope)).

An agent never needs to parse a table or answer a prompt. Only `jm auth login` prompts, so log in yourself before the session starts.

## Learn the Commands

The agent asks `jm` what it can do:

```
pnpm jm -- help --json
```

The result lists every command with its flags, an example and the shape of its `data`. For one command:

```
pnpm jm -- help issue edit --json
```

## Read the Tree

```
pnpm jm -- issue tree --mine --json
```

`data` holds one group per Customer, each with its Epics and their issues. To read one issue, including its description as Markdown:

```
pnpm jm -- issue get <key> --json
```

Try a key that does not exist and watch the failure:

```
pnpm jm -- issue get PSAPAC-999999 --json
```

The exit code is 3 and the envelope holds `"code": "not_found"`. An agent branches on the code, never on the message text.

## Edit One Field

This step changes a real issue. Pick one of your own that you are happy to touch. Add a label:

```
pnpm jm -- issue edit <key> --add-label agent-test --json
```

`data` lists the key and the options sent, such as `{"key": "...", "changed": ["label"]}`. Check it with `pnpm jm -- issue get <key> --json` and look in `labels`. Then undo it:

```
pnpm jm -- issue edit <key> --remove-label agent-test --json
```

## Brief the Agent

Give the agent these rules:

- Call `jm` with `--json` and read stdout as one JSON value.
- Branch on the exit code and `error.code`.
- Read `jm help --json` instead of guessing a flag.
- Run commands one at a time. After a failed write, read the issue before repeating it.
- Never read or print the Keychain item.

## Next

- [CLI reference](../reference/cli.md) documents every command.
- [Errors](../reference/errors.md) explains each code and its fix.
