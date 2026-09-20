import { telegram_notify } from '#scripts/git/telegram-notify'
import type { CarryRead } from './run-carry'

// **A `backlogrun` that halts because a person is needed used to reach nobody once the session was
// cut** (joshuafolkken/kit#2136). Every remaining child blocked behind a parked one, the backlog
// drained of anything runnable, the failure streak tripped — each ends the run, and while the session
// was the person's the stop was there in the conversation. After a cut the parent is a headless
// `claude -p backlogrun`, so the stop reached its own transcript and nowhere else, and the run sat
// stopped until someone thought to ask. The 15-minute heartbeat stays a pull; a *stop* is a state
// change, and a state change is what `confirmation` exists to push.
//
// **This is the decision, kept apart from the send so the dedup can be pinned without a Telegram.**
// `run:carry --end` calls `plan` on the record it is about to remove; `announce` only runs when a
// notice comes back.

interface StopNotice {
	reason: string
}

const STOP_TITLE = 'backlogrun stopped'
const STOP_RECOVERY =
	'If this did not arrive, `pnpm josh run:wake --list` relays the last progress line.'

// **Only a stop over a record that is still there is announced, and that is the whole of the dedup**
// (joshuafolkken/kit#2136). `--end` removes the record, so a second `--end --stopped` — a retried
// turn, a re-evaluation — reads `none` and plans nothing, which is why one event never sends twice. A
// clean finish passes no reason and stays silent, because a completed run has its own notification and
// this type is for the run that halted needing a person. An `unreadable` record is not announced: with
// nothing readable there is no run this can honestly say stopped.
function plan(read: CarryRead, reason: string | undefined): StopNotice | undefined {
	if (reason === undefined || reason.length === 0) return undefined
	if (read.kind !== 'carried' && read.kind !== 'expired') return undefined

	return { reason }
}

async function announce(notice: StopNotice): Promise<boolean> {
	return await telegram_notify.confirm({
		issue_title: STOP_TITLE,
		body: notice.reason,
		recovery: STOP_RECOVERY,
	})
}

const run_stop_notify = {
	STOP_RECOVERY,
	STOP_TITLE,
	announce,
	plan,
}

export { run_stop_notify }
