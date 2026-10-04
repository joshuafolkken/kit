# Set up notifications

## When to use it

You want a Telegram message when a workflow run needs you or finishes. Every workflow keyword sends them, so set this up before your first run.

## Steps

1. Create a bot and get its token ([`TELEGRAM_BOT_TOKEN`](#telegram_bot_token)).
2. Send the bot a message and read your chat ID ([`TELEGRAM_CHAT_ID`](#telegram_chat_id)).
3. Open `.env` at the project root — `josh init` creates it on the `full` profile; otherwise create it — and add the two values. `.env` is not committed.

   ```ini
   TELEGRAM_BOT_TOKEN=<your-bot-token>
   TELEGRAM_CHAT_ID=<your-chat-id>
   ```

4. Optionally add `JOSH_SESSION_LANG=en` for English message bodies; it defaults to Japanese ([`josh session:lang`](../josh-commands-automation.md#josh-sessionlang)).
5. Send a test message with [`josh notify`](../josh-commands-automation.md#josh-notify) and the `confirmation` task type.

Not using Telegram at all? Add `JOSH_NOTIFY=off` to `.env` instead of the two credentials; every notification is then skipped with exit code 0 ([notification behavior](../environment-variables.md#notification-behavior)). Every other variable kit reads is in [environment-variables.md](../environment-variables.md).

In a cloud session, set the same values as environment variables instead of a `.env` file ([cloud-session.md](../cloud-session.md#environment-variables)).

### `TELEGRAM_BOT_TOKEN`

Authenticates with the Telegram Bot API.

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts to name your bot.
3. Copy the API token BotFather provides (format: `123456789:ABCdef...`).

### `TELEGRAM_CHAT_ID`

Identifies the chat or user that receives notifications.

1. Start a conversation with your bot on Telegram and send it any message.
2. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser — the `chat.id` field in the response JSON is your chat ID.
3. Alternatively, forward a message to [@userinfobot](https://t.me/userinfobot) to find your personal user ID.

## Check it worked

- The test message arrives, and `josh notify` exits zero.

## Common failures

- `josh notify` exits non-zero: it names the missing variable or the HTTP status Telegram returned ([notification behavior](../environment-variables.md#notification-behavior)).
- No message arrives although the command succeeded: the chat ID belongs to a different chat — read it again after messaging the bot.
