import { stamp_file } from '#scripts/josh/stamp-file'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_hold, type RunHold, type SessionOwner } from './run-hold'

// What the `Stop` hook asks of a hold beyond "is one in place" (joshuafolkken/kit#3961): whether it is
// this session's own run's, and whether its pause was already announced.
//
// **Another run's hold is not this session's pause.** A `kickoff`, or a question answered while a
// `backlogrun` parent holds the same tree, stops in a session that holds nothing — announcing that stop
// as the held run's "confirmation required" reports a decision nobody is waiting on.
//
// **Unknown is this session's own.** A record written outside an agent session, or a hook that cannot
// read its own session, keeps the behavior the hold had before ownership was recorded: a missed notify
// costs a person a silent pause, a wrong one only a needless Telegram.

function is_same_start(recorded: string | undefined, own: string | undefined): boolean {
	return recorded === undefined || own === undefined || recorded === own
}

function is_session_hold(hold: RunHold, owner: SessionOwner = run_hold.session_owner()): boolean {
	if (hold.owner_pid === undefined || owner.owner_pid === undefined) return true

	return hold.owner_pid === owner.owner_pid && is_same_start(hold.owner_start, owner.owner_start)
}

// **A pause is announced once, and a person's prompt ends it.** The hook's own send is recorded on the
// hold, so a later stop of the same pause — a background notice that woke the session — finds it; a send before `pause_start` belongs to an earlier pause. An unknown start
// announces again: a needless Telegram costs less than a silent wait.
function is_notified_since(hold: RunHold, pause_start: string | undefined): boolean {
	if (pause_start === undefined || hold.notified_at === undefined) return false

	return Date.parse(hold.notified_at) >= Date.parse(pause_start)
}

// Stamps the send on the record in place; a tree no longer held has nothing to stamp. A stale record is
// stamped too: the hook reads it as the hold (`hold_of`), so a run past the expiry age still finds its send.
function mark_notified(target: string, now: Date = new Date()): void {
	const hold = run_halfrun_resume.hold_of(run_hold.read_hold(target, now))
	if (hold === undefined) return

	stamp_file.write_stamp(target, { ...hold, notified_at: now.toISOString() })
}

const run_hold_session = { is_notified_since, is_session_hold, mark_notified }

export { run_hold_session }
