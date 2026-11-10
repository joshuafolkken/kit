import { issue_cite } from '#scripts/issue/issue-cite'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_merge_usage_limit } from './run-merge-usage-limit'

// A returned child whose session could not authenticate (joshuafolkken/kit#4216). Nothing is counted
// and no park label is put on it: the caller releases it for the backlog to offer again, and launches
// are held as a usage limit holds them (`run-merge-usage-limit.ts`), re-tried every `RECHECK_MS` —
// the run does not stop, so it resumes by itself once a person has run `/login` (joshuafolkken/kit#7078).
// `/login` is a person's to run, so the first such hold since the last merge is pushed as a
// `confirmation`; later ones are not, so a long wait sends it once and a failure after recovery again. **It is no `OUTAGE`**: the per-child cap counts those
// (`run-merge-cap.ts`). Script-emitted, so English.

const LIMIT = 'authentication failure'
const RECHECK_MS = 600_000
const RECHECK_TEXT = '10 minutes'
const RECOVERY =
	'If this did not arrive, `pnpm josh run:wake --list` relays the last progress line.'

async function is_first_hold(): Promise<boolean> {
	const events = await run_event_stream_emit.current_events()

	return run_event_stream
		.since(events, run_event_stream.EVENT_KIND.MERGE)
		.every(
			(event) =>
				!(event.kind === run_event_stream.EVENT_KIND.USAGE_LIMIT && event.text.includes(LIMIT)),
		)
}

async function notify(child: string): Promise<void> {
	const cite = issue_cite.plain_for('telegram', child)
	const text = `${cite} could not authenticate — run /login; the run resumes by itself`

	await telegram_notify.confirm({
		issue_title: 'backlogrun waiting: Claude authentication failed',
		body: `${text}. Launches are held and re-tried every ${RECHECK_TEXT}; the child was released, neither parked nor counted as a failure.`,
		recovery: RECOVERY,
		recommended: 'Run /login',
		alternatives: ['Stop the run with `pnpm josh backlogrun --stop`'],
	})
}

async function hold(child: string, now_ms: number): Promise<void> {
	const is_first = await is_first_hold()

	await run_merge_usage_limit.record(child, now_ms + RECHECK_MS, LIMIT)

	if (is_first) await notify(child)
}

const run_merge_auth = { hold }

export { run_merge_auth }
