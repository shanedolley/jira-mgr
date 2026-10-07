# End-to-End Tests

Playwright tests that cross package boundaries. Unit and integration tests sit beside the code they test.

| Suite      | Drives                                                      |
| ---------- | ----------------------------------------------------------- |
| `desktop/` | The built desktop app, through Playwright's Electron driver |

## Run

```
pnpm e2e
```

The command builds the desktop app, then launches it from `apps/desktop`. On Linux without a display, run `xvfb-run --auto-servernum pnpm e2e`. When `CI` is set, the test passes `--no-sandbox` to Electron, because GitHub's runners lack the setuid sandbox helper.

Electron downloads its binary on first launch.

The CLI will get a `cli/` suite that runs the built `jm` binary as a subprocess and checks `--json` output and exit codes.
