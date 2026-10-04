# Set up notifications

## When to use it

You want a Telegram message when a workflow run needs you or finishes. Every workflow keyword sends them and `josh notify` exits non-zero without the credentials, so set this up — or turn notifications off with `JOSH_NOTIFY=off` — before your first run.

## Steps

1. Create a bot and get its token ([`TELEGRAM_BOT_TOKEN`](../scripts-ai.md#telegram_bot_token)).
2. Send the bot a message and read your chat ID ([`TELEGRAM_CHAT_ID`](../scripts-ai.md#telegram_chat_id)).
3. Open `.env` at the project root — `josh init` creates it on the `full` profile; otherwise create it — and add the two values. `.env` is not committed.

   ```ini
   TELEGRAM_BOT_TOKEN=<your-bot-token>
   TELEGRAM_CHAT_ID=<your-chat-id>
   ```

4. Optionally add `JOSH_SESSION_LANG=en` for English message bodies; it defaults to Japanese ([`josh session:lang`](../josh-commands-automation.md#josh-sessionlang)).
5. Send a test message with [`josh notify`](../josh-commands-automation.md#josh-notify) and the `confirmation` task type.

Not using Telegram at all? Add `JOSH_NOTIFY=off` to `.env` instead of the two credentials; every notification is then skipped with exit code 0 ([`JOSH_NOTIFY`](../scripts-ai.md#josh_notify)). Every other variable kit reads is in [environment-variables.md](../environment-variables.md).

In a cloud session, set the same values as environment variables instead of a `.env` file ([cloud-session.md](../cloud-session.md#environment-variables)).

## Check it worked

- The test message arrives, and `josh notify` exits zero.

## Common failures

- `josh notify` exits non-zero: it names the missing variable or the HTTP status Telegram returned ([notification behavior](../scripts-ai.md#notification-behavior)).
- No message arrives although the command succeeded: the chat ID belongs to a different chat — read it again after messaging the bot.
