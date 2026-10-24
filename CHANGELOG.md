# Changelog

## [1.0.1] - 2026-10-25

### Added

- Cmd+Enter (Ctrl+Enter off macOS) submits the forms that lacked it: Log work, the worklog add and edit rows, the link add row, the timer stop dialog, the Edit summary dialog and the login screen. [#364](https://github.com/shanedolley/jira-mgr/pull/364), issue [#362](https://github.com/shanedolley/jira-mgr/issues/362)
- `W` opens a Worklogs modal for the active issue. It lists every worklog, newest start first, with the total logged, and lets you edit and delete your own rows. The issue menu and the palette offer Worklogs too. [#365](https://github.com/shanedolley/jira-mgr/pull/365), issue [#363](https://github.com/shanedolley/jira-mgr/issues/363)

### Changed

- The desktop app is now `Jira Task Manager.app`, replacing `jira-mgr.app`. Its window, menu bar, Dock name and login screen read "Jira Task Manager", and the release zip is `jira-task-manager-<version>-arm64.zip`. Delete the old `jira-mgr.app` when you upgrade; your login, settings, saved views, timer and theme carry over ([upgrade notes](docs/how-to/install-desktop-app.md#download-a-release)). The `jm` CLI keeps its name. [#371](https://github.com/shanedolley/jira-mgr/pull/371), [#376](https://github.com/shanedolley/jira-mgr/pull/376), issues [#369](https://github.com/shanedolley/jira-mgr/issues/369) and [#375](https://github.com/shanedolley/jira-mgr/issues/375)
- Log work moves from `W` to `Shift+T`. Lowercase `t` still starts and stops the timer. [#365](https://github.com/shanedolley/jira-mgr/pull/365)

## [1.0.0] - 2026-10-21

First release: see the [v1.0.0 release](https://github.com/shanedolley/jira-mgr/releases/tag/v1.0.0).
