# josh init — rationale and history

History behind [init.md](../init.md), kept here so the user-facing page describes only current behavior.

## Retired package scripts

`josh init` once added these scripts to a project's `package.json`; they are no longer managed, and their behavior lives in the `josh` CLI ([josh-commands.md](../josh-commands.md)): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`, `check:svelte`, `check:svelte:ci`.
