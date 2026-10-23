import { issue_cite } from '#scripts/issue/issue-cite'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// A returned child whose session could not authenticate (joshuafolkken/kit#4216). Nothing is counted
// and no label is touched — the child keeps `in-progress`, so it resumes once a person runs `/login` —
// and the run stops, since every child dispatched before that fails the same way. The stop is pushed
// as a `confirmation`: `/login` is a person's to run, and the driver's own stop notice names no cause.
// Script-emitted, so English.

const RECOVERY =
	'If this did not arrive, `pnpm josh run:wake --list` relays the last progress line.'

async function stop(child: string): Promise<void> {
	const cite = issue_cite.plain(child)
	const text = `${cite} could not authenticate — run /login, then resume it`

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.OUTAGE, text)
	await telegram_notify.confirm({
		issue_title: 'backlogrun stopped: Claude authentication failed',
		body: `${text}. The child stays in-progress and was neither parked nor counted as a failure.`,
		recovery: RECOVERY,
		recommended: `Run /login, then run backlogrun again to resume ${cite}`,
		alternatives: ['Leave the backlog stopped until a later session'],
	})
}

const run_merge_auth = { stop }

export { run_merge_auth }
