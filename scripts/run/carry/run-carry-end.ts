import { run_merge_collect } from '#scripts/run/merge/run-merge-collect'
import { run_stop_notify } from '#scripts/run/run-stop-notify'
import { run_carry, type CarryRead } from './run-carry'
import { run_carry_ended } from './run-carry-ended'
import { run_carry_stash } from './run-carry-stash'

// Ending a run's record, apart from the command that prints the verdict: `run:carry --end` and
// `josh backlogrun --stop` both end it here, so the one end is never written twice.

interface EndRequest {
	// Why the run stopped; `undefined` is a clean finish.
	stopped: string | undefined
	// Whether a stop pushes its ⏸️ confirmation. A person who typed the stop is already at the terminal.
	is_announced: boolean
}

// **A stop over a record that is still there pushes one ⏸️ confirmation before the record goes**.
// `plan` is read from the record the end is about to remove, so the second end reads `none` and
// plans nothing — one stop never notifies twice. A clean end passes no reason and stays silent,
// because a completed run has its own notification.
async function announce_stop(read: CarryRead, request: EndRequest): Promise<void> {
	if (!request.is_announced) return

	const notice = run_stop_notify.plan(read, request.stopped)

	if (notice !== undefined) await run_stop_notify.announce(notice)
}

// The closed-issue stash report (`run-carry-stash.ts`) is once per invocation on the same read.
async function report_end(read: CarryRead): Promise<void> {
	if (read.kind === 'none') return

	await run_carry_stash.report_orphans()
}

// Best-effort: the board's record of the ended run never stands between the end and the carry record it
// clears, so a failed write goes to stderr rather than leaving the run carried.
function keep_ended(directory: string, read: CarryRead, stopped: string | undefined): void {
	try {
		run_carry_ended.record_ended(run_carry_ended.ended_path(directory), read, new Date(), stopped)
	} catch (error) {
		console.error(`run:carry: the ended run was not recorded for run:board: ${String(error)}`)
	}
}

// The record goes, and the run it held stays readable as the last ended run, so `run:board` keeps the
// finished run on screen until the next one begins — a stopped one with the session to resume it from.
function close_record(directory: string, stopped: string | undefined): CarryRead {
	const target = run_carry.carry_path(directory)
	const read = run_carry.read_carry(target)

	keep_ended(directory, read, stopped)
	run_carry.end_carry(target)

	return read
}

// The merges the run ended with are recorded while its record can still count them. The read handed
// back is the record as it stood before it was removed.
async function end_run(directory: string, request: EndRequest): Promise<CarryRead> {
	await run_merge_collect.collect_merged(directory)
	const read = close_record(directory, request.stopped)

	await announce_stop(read, request)
	await report_end(read)

	return read
}

const run_carry_end = { end_run }

export type { EndRequest }
export { run_carry_end }
