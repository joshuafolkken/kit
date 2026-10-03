# AI Workflow Automation

For projects using the AI Issue workflow (`josh followup`, `josh notify`): the Telegram settings and what the commands do.

## Required Environment Variables

Create a `.env` file at the project root:

```ini
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

Every other variable kit reads — required or not, with its default — is listed in [environment-variables.md](./environment-variables.md).

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

Optional. Set `JOSH_NOTIFY=off` when you do not use Telegram at all. Every notification is then skipped with one `🔕 Telegram notifications are disabled` line and exit code 0, and neither Telegram variable is needed. Only `off` (case-insensitive) disables them: unset or any other value keeps the behavior below, so a forgotten setup still fails rather than passing quietly.

## Commands

| Command         | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `josh followup` | Wait for CI, scan AI reviews, notify, and optionally merge PR |
| `josh notify`   | Send a one-off Telegram notification with a task-type header  |
| `josh git`      | AI-assisted commit, push, and PR creation workflow            |

Which source file implements each command: `docs/maintainers/scripts-ai-rationale.md` → "Where the scripts live".

## Notification Behavior

**A notification that reached nobody is a failure, not a skip.** Missing credentials and a refused request are treated the same way, and what happens next depends only on whose job the notification was.

An explicit [`JOSH_NOTIFY=off`](#josh_notify) is the one exception: it records that nobody is meant to be notified, so every send is skipped and nothing below applies.

When `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing or empty, or the send itself fails:

- `josh notify` **exits non-zero**. The message names the missing variables, or the HTTP status the API answered with — never the value of either credential.
- `josh followup` **reports the failure and carries on**, because it sends its completion message on the way to the merge and a gateway timeout at Telegram is not a reason to leave a reviewed, green pull request unmerged. The report is its own `❗` block on stderr, carrying the recovery command where one exists. The rest of that run — CI watching, the merge, the completion comment, the epic close — happens exactly as it would have; only the Telegram delivery is missing.

A missing `.env` file is not itself an error: both commands also read the two variables from the environment, so a cloud session that sets them there notifies normally. Rationale: `docs/maintainers/scripts-ai-rationale.md` → "Why a missing .env no longer stops the notification commands".
