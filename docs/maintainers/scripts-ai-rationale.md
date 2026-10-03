# AI workflow automation — rationale

History behind [scripts-ai.md](../scripts-ai.md), kept here so the user-facing page states only what
the commands do. Nothing here is read during a run.

## Why a missing .env no longer stops the notification commands

`josh notify` and `josh followup` used to pass node's mandatory `--env-file=.env`, which aborts before
the script's first line when the file is missing — loud, but by accident, and it stopped a cloud
session that carried both credentials as real environment variables. They now use
`--env-file-if-exists=.env` like every other command, and the failure reporting in
[Notification Behavior](../scripts-ai.md#notification-behavior) is what replaces that loudness
([#1564](https://github.com/joshuafolkken/kit/issues/1564)). A machine that genuinely has no Telegram
configured therefore sees `josh notify` fail rather than pass quietly; `josh followup` still
completes. `JOSH_NOTIFY=off` was added afterwards as the explicit way to say nobody is meant to be
notified ([#2821](https://github.com/joshuafolkken/kit/issues/2821)).

## Where the scripts live

The scripts behind `josh git`, `josh followup` and `josh notify` live under `scripts/git/` —
`git-workflow.ts`, `git-followup-workflow.ts` and `telegram-test.ts`. They were a separate
`scripts-ai/` directory until [#2903](https://github.com/joshuafolkken/kit/issues/2903), which is where
this page's name comes from.
