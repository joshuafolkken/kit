# josh init — rationale and history

History behind [init.md](../init.md), kept here so the user-facing page describes only current behavior.

## Retired package scripts

`josh init` once added these scripts to a project's `package.json`; they are no longer managed, and their behavior lives in the `josh` CLI ([josh-commands.md](../josh-commands.md)): `git`, `git:followup`, `telegram:test`, `audit:security`, `prep`, `issue:prep`, `prevent-main-commit`, `check-commit-message`, `version:*`, `overrides:check`, `check:ci`, `check:svelte`, `check:svelte:ci`.

## Renamed profiles

`basic` and `full` were called `static` and `node` until joshuafolkken/kit#2829.

## Where each section came from

The issues behind each section of [init.md](../init.md), kept here so the page carries no provenance
citations.

| Section                       | Issues                            |
| ----------------------------- | --------------------------------- |
| Project profiles              | #2814, #2818, #2829               |
| `josh init` or `josh start`   | #2816                             |
| Run from outside the project  | #2794, #2866                      |
| Package scripts               | #1503, #1507, #2707, #2711, #3095 |
| Dependencies                  | #2710                             |
| tsconfig exclude              | #796                              |
| AI files                      | #963, #1878, #1879, #2990         |
| Tool installs                 | #2766                             |
| Dependency barrier (pre-push) | #813                              |
