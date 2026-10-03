# AI Workflow Automation

For projects using the AI Issue workflow (`josh followup`, `josh notify`): the Telegram settings and what the scripts do. The scripts that power the `josh git`, `josh followup` and `josh notify` commands live under `scripts/git/`, `scripts/followup/` and `scripts/notify/` (they were a separate `scripts-ai/` directory until [#2903](https://github.com/joshuafolkken/kit/issues/2903), and were split out of `scripts/git/` by [#2988](https://github.com/joshuafolkken/kit/issues/2988)).

## Required Environment Variables

Create a `.env` file at the project root:

```ini
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

The `.env` file is loaded automatically by AI scripts on startup. Without both variables `josh notify` exits non-zero, while `josh followup` reports the missed notification and still completes (see [Notification Behavior](#notification-behavior)).

### `TELEGRAM_BOT_TOKEN`

Authenticates with the Telegram Bot API.

**How to get:**

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to name your bot
3. Copy the API token BotFather provides (format: `123456789:ABCdef...`)

### `TELEGRAM_CHAT_ID`

Identifies the chat or user that receives notifications.

**How to get:**

1. Start a conversation with your bot on Telegram
2. Send any message to the bot
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser — the `chat.id` field in the response JSON is your chat ID
4. Alternatively, forward a message to [@userinfobot](https://t.me/userinfobot) to find your personal user ID

### `JOSH_NOTIFY`

Optional. Set `JOSH_NOTIFY=off` when you do not use Telegram at all ([#2821](https://github.com/joshuafolkken/kit/issues/2821)). Every notification is then skipped with one `🔕 Telegram notifications are disabled` line and exit code 0, and neither Telegram variable is needed. Only `off` (case-insensitive) disables them: unset or any other value keeps the behavior below, so a forgotten setup still fails rather than passing quietly.

## Commands

| Command         | Script                                      | Description                                                   |
| --------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `josh followup` | `scripts/followup/git-followup-workflow.ts` | Wait for CI, scan AI reviews, notify, and optionally merge PR |
| `josh notify`   | `scripts/notify/telegram-test.ts`           | Send a one-off Telegram notification with a task-type header  |
| `josh git`      | `scripts/git/git-workflow.ts`               | AI-assisted commit, push, and PR creation workflow            |

## Notification Behavior

**A notification that reached nobody is a failure, not a skip** ([#1564](https://github.com/joshuafolkken/kit/issues/1564)). Missing credentials and a refused request are treated the same way, and what happens next depends only on whose job the notification was.

An explicit [`JOSH_NOTIFY=off`](#josh_notify) is the one exception: it records that nobody is meant to be notified, so every send is skipped and nothing below applies.

When `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing or empty, or the send itself fails:

- `josh notify` **exits non-zero**. The message names the missing variables, or the HTTP status the API answered with — never the value of either credential.
- `josh followup` **reports the failure and carries on**, because it sends its completion message on the way to the merge and a gateway timeout at Telegram is not a reason to leave a reviewed, green pull request unmerged. The report is its own `❗` block on stderr, carrying the recovery command where one exists. The rest of that run — CI watching, the merge, the completion comment, the epic close — happens exactly as it would have; only the Telegram delivery is missing.

**This is why the notification commands no longer die on a machine with no `.env`.** `josh notify` and `josh followup` used to pass node's mandatory `--env-file=.env`, which aborts before the script's first line when the file is missing — loud, but by accident, and it stopped a cloud session that carried both credentials as real environment variables. They now use `--env-file-if-exists=.env` like every other command, and the loudness above is what replaces it. A machine that genuinely has no Telegram configured will therefore see `josh notify` fail rather than pass quietly; `josh followup` still completes.
