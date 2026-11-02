# Changelog

## [1.1.0] - 2026-11-03

### Added

- Date fields take a typed phrase or dd/mm/yyyy: `next tuesday`, `tues`, `3 weeks`, `1 year ago`, `nov 10`. This covers the Start date and Due date in the Tree and Sprint cell editor, the issue page, the create dialog's chips and the issue menu. Each field shows the day it means (`Tue 10 Nov 2026`) before it saves. A phrase that cannot be read saves nothing, stays in the field and shows "Could not read the date". The `jm` CLI keeps ISO dates for `--start` and `--due`. [#402](https://github.com/shanedolley/jira-mgr/pull/402), issue [#401](https://github.com/shanedolley/jira-mgr/issues/401)
- A date field shows the day its text means in a suggestion under the field. Tab or a click on the suggestion replaces the text with the day (`10 Nov`, or `10 Nov 2027` in another year) and saves it. [#406](https://github.com/shanedolley/jira-mgr/pull/406), issue [#405](https://github.com/shanedolley/jira-mgr/issues/405)
- The Started field of a work log takes date and time phrases (`yesterday 2pm`, `5pm yesterday`, `today 9:30`, `10 Nov, 14:30`). A phrase with no time keeps the time already in the field, and a phrase with only a time keeps the day. [#406](https://github.com/shanedolley/jira-mgr/pull/406), issue [#405](https://github.com/shanedolley/jira-mgr/issues/405)
- The Peek shows editable Start date and Due date rows after Labels. They take the same phrases and suggestion as the issue page. [#411](https://github.com/shanedolley/jira-mgr/pull/411), issue [#409](https://github.com/shanedolley/jira-mgr/issues/409)

### Changed

- A saved date shows as `10 Nov` in its field instead of `2026-11-10`. [#406](https://github.com/shanedolley/jira-mgr/pull/406)
- The first Esc in a date field closes its suggestion and keeps the text. The next Esc drops the draft and closes the editor, as before. [#406](https://github.com/shanedolley/jira-mgr/pull/406)
- Tab on a suggestion in the cell editor saves the day and ends the edit, as Enter does. [#406](https://github.com/shanedolley/jira-mgr/pull/406)
- Esc in a date field with nothing to abandon closes the issue page or the Peek in one press. [#411](https://github.com/shanedolley/jira-mgr/pull/411)

### Fixed

- A date field selects its text when it gains focus, so a phrase typed over a saved date replaces it. It used to append (`2 Jan 2020next tuesday`), which read as no date. [#410](https://github.com/shanedolley/jira-mgr/pull/410), issue [#408](https://github.com/shanedolley/jira-mgr/issues/408)
- Plain Enter in a create-dialog date chip accepts the suggestion instead of submitting the form. Enter with no suggestion open still submits. [#410](https://github.com/shanedolley/jira-mgr/pull/410), issue [#408](https://github.com/shanedolley/jira-mgr/issues/408)

## [1.0.1] - 2026-10-25

### Added

- Cmd+Enter (Ctrl+Enter off macOS) submits the forms that lacked it: Log work, the worklog add and edit rows, the link add row, the timer stop dialog, the Edit summary dialog and the login screen. [#364](https://github.com/shanedolley/jira-mgr/pull/364), issue [#362](https://github.com/shanedolley/jira-mgr/issues/362)
- `W` opens a Worklogs modal for the active issue. It lists every worklog, newest start first, with the total logged, and lets you edit and delete your own rows. The issue menu and the palette offer Worklogs too. [#365](https://github.com/shanedolley/jira-mgr/pull/365), issue [#363](https://github.com/shanedolley/jira-mgr/issues/363)

### Changed

- The desktop app is now `Jira Task Manager.app`, replacing `jira-mgr.app`. Its window, menu bar, Dock name and login screen read "Jira Task Manager", and the release zip is `jira-task-manager-<version>-arm64.zip`. Delete the old `jira-mgr.app` when you upgrade; your login, settings, saved views, timer and theme carry over ([upgrade notes](docs/how-to/install-desktop-app.md#download-a-release)). The `jm` CLI keeps its name. [#371](https://github.com/shanedolley/jira-mgr/pull/371), [#376](https://github.com/shanedolley/jira-mgr/pull/376), issues [#369](https://github.com/shanedolley/jira-mgr/issues/369) and [#375](https://github.com/shanedolley/jira-mgr/issues/375)
- Log work moves from `W` to `Shift+T`. Lowercase `t` still starts and stops the timer. [#365](https://github.com/shanedolley/jira-mgr/pull/365)
- Updated the dependencies the app ships with: Electron from 44.7.0 to 44.7.2, Tiptap from 3.31.4 to 3.32.0, TanStack Query from 5.104.1 to 5.104.2, marked from 18.1.0 to 18.1.1 and zod from 4.6.5 to 4.6.7. [#351](https://github.com/shanedolley/jira-mgr/pull/351)

## [1.0.0] - 2026-10-22

First release: see the [v1.0.0 release](https://github.com/shanedolley/jira-mgr/releases/tag/v1.0.0).
