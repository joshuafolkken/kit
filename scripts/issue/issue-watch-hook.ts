import { hook_context, type HookContext } from '#scripts/hooks/hook-context'
import { error_text } from '#scripts/lib/error-message'
import { issue_watch, type WatchRecord } from './issue-watch'
import { issue_watch_gate } from './issue-watch-gate'

// The `PreToolUse` adapter that shows a run a person's update to its issue on the next tool call,
// composed into `pretool-guard.ts` — the one PreToolUse hook — rather than added as a second
// `.claude/settings.json` entry.
//
// **It polls at most once per interval.** Every tool call reads the checkout's record from disk; only
// one whose last poll is older than `POLL_INTERVAL_MS` asks GitHub, with the ETag of the previous
// answer, so an unchanged issue costs a 304. The request is bounded well under the hook's own timeout.
//
// **It refuses once per update.** The refusal is what puts the update in front of the run; repeating
// it on every call would wedge the run before it could act. A further update changes the pending text
// and is shown again. `josh issue:ack` clears it, and the review attestation and `josh followup` keep
// refusing until it does — the hook is the early warning, not the enforcement.
//
// **It fails open.** No record, an unreadable issue or a thrown error allows the call: a hook that
// stalls every tool call over a network blip would cost more than the update it watches for.

const POLL_INTERVAL_MS = 180_000
const POLL_TIMEOUT_MS = 5000

function is_new_to_run(record: WatchRecord | undefined): record is WatchRecord {
	const news = record === undefined ? undefined : issue_watch.news_of(record)

	return news !== undefined && news !== record?.shown
}

// A withheld body edit is shown as its own notice: it asks for no `josh issue:ack`.
function message_of(record: WatchRecord): string {
	return record.pending === undefined
		? (record.notice ?? '')
		: issue_watch_gate.unread_message(record)
}

async function new_update_reason(now: Date, root: string): Promise<string | undefined> {
	const options = { interval_ms: POLL_INTERVAL_MS, timeout_ms: POLL_TIMEOUT_MS, now }
	const record = await issue_watch.poll(options, root)

	if (!is_new_to_run(record)) return undefined

	issue_watch.mark_shown(record, root)

	return message_of(record)
}

// The record is the one keyed on `context.cwd`, the call's working directory.
async function watch_reason(
	context: HookContext = hook_context.from_process(),
	now: Date = new Date(),
): Promise<string | undefined> {
	try {
		return await new_update_reason(now, context.cwd)
	} catch (error) {
		error_text.trace_swallowed('issue_watch_hook.watch_reason', error)

		return undefined
	}
}

const issue_watch_hook = { POLL_INTERVAL_MS, watch_reason }

export { issue_watch_hook }
