# A or B: with or without GitHub

The README's [Quick start](../../README.md#quick-start) offers two setups; pick one. A runs `josh start`, B runs `josh init`. Which command fits which situation, and how to move from B to A later, is in [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start).

## What you can do

|                                                           | A. With GitHub                       | B. Without GitHub |
| --------------------------------------------------------- | ------------------------------------ | ----------------- |
| AI assistant rules, formatting and `josh gate` checks     | Yes                                  | Yes               |
| Issue workflow — `kickoff`, `fullrun`, `prrun`, `halfrun` | Yes                                  | No                |
| Unattended runs over the backlog — `backlogrun`           | Yes                                  | No                |
| Needs                                                     | Node.js, pnpm, the gh CLI and GitHub | Node.js and pnpm  |

## What is added

Both run the same setup: the files it writes depend on the project's [profile](../init.md#project-profiles) — see [basic.md](./basic.md#2-install-kit-and-initialize) and [full.md](./full.md). The exception is a `basic` project, where A also writes `.claude/settings.json` — the permissions and hooks its unattended agents need — and B does not ([init.md → Project profiles](../init.md#project-profiles)). A then carries the project to GitHub:

|                                                           | A. With GitHub                   | B. Without GitHub |
| --------------------------------------------------------- | -------------------------------- | ----------------- |
| AI assistant rules, editor settings and the `josh` script | Yes                              | Yes               |
| Git repository (`git init` on `main`, initial commit)     | When the project has no Git      | No                |
| Private GitHub repository (`gh repo create`, push)        | When the project has no `origin` | No                |
| Workflow and release-classification labels                | Yes                              | No                |
| Setup pull request                                        | When `main` already has history  | No                |
