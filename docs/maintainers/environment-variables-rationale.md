# Environment variables — rationale

History behind the notification settings in [environment-variables.md](../environment-variables.md),
kept here so the user-facing page states only what the commands do. Nothing here is read during a run.

The Telegram setup and the notification behavior used to be a page of their own, `docs/scripts-ai.md`,
named after the `scripts-ai/` directory that held `josh git`, `josh followup` and `josh notify` until
[#2903](https://github.com/joshuafolkken/kit/issues/2903). [#3070](https://github.com/joshuafolkken/kit/issues/3070)
folded it into [set-up-notifications.md](../how-to/set-up-notifications.md) and
environment-variables.md, so the credential steps are written once.

## Why a missing .env no longer stops the notification commands

`josh notify` and `josh followup` used to pass node's mandatory `--env-file=.env`, which aborts before
the script's first line when the file is missing — loud, but by accident, and it stopped a cloud
session that carried both credentials as real environment variables. They now use
`--env-file-if-exists=.env` like every other command, and the failure reporting in
[Notification behavior](../environment-variables.md#notification-behavior) is what replaces that loudness
([#1564](https://github.com/joshuafolkken/kit/issues/1564)). A machine that genuinely has no Telegram
configured therefore sees `josh notify` fail rather than pass quietly; `josh followup` still
completes. `JOSH_NOTIFY=off` was added afterwards as the explicit way to say nobody is meant to be
notified ([#2821](https://github.com/joshuafolkken/kit/issues/2821)).
