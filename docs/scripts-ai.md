# scripts-ai/ — AI Workflow Automation

The `scripts-ai/` directory contains automation scripts for AI-assisted development workflows. These scripts power the `josh followup`, `josh notify`, `josh prep`, and `josh issue` commands.

## Required Environment Variables

Create a `.env` file at the project root:

```ini
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

The `.env` file is loaded automatically by AI scripts on startup. Both variables are optional — if either is missing, Telegram notifications are skipped with a warning and the workflow continues.

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

## Commands

| Command         | Script                     | Description                                                   |
| --------------- | -------------------------- | ------------------------------------------------------------- |
| `josh followup` | `git-followup-workflow.ts` | Wait for CI, scan AI reviews, notify, and optionally merge PR |
| `josh notify`   | `telegram-test-logic.ts`   | Send a one-off Telegram notification with a task-type header  |
| `josh prep`     | `prep.ts`                  | Switch to main, pull, update dependencies, verify overrides   |
| `josh issue`    | `issue-prep.ts`            | Fetch GitHub issue details for AI context                     |
| `josh git`      | `git-workflow.ts`          | AI-assisted commit, push, and PR creation workflow            |

## Notification Behavior

When `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing or empty:

- A warning is printed: `⚠️  Telegram not configured: ... Skipping.`
- `josh notify` exits after the warning without sending a notification
- `josh followup` skips the notification step and continues CI watching and PR management
- The rest of the workflow runs normally — only the Telegram delivery is omitted

This allows using git workflow commands in environments without Telegram configured (e.g., other team members' machines or CI).
