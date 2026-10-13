import { run_board_labels } from './run-board-labels'
import type { RunActivity } from './run-board-status'

// The header's third line: what the run is doing now, in words. Always one line while the stream holds
// an event — the stage the run is at and how long it has stood there, else how many children run, else
// how long it has watched, each with why; an ended run keeps the newest thing it did. Every time is
// counted from an event's own, so the line never guesses one.

const { WORDS, stage_span_of } = run_board_labels
const REASON_SEPARATOR = ' — '

interface NowRead {
	now_ms: number
	// Set once the run has ended: the newest event's age stops there.
	ended_ms: number | undefined
	activity: RunActivity
	running: number
	// What the plan has left for the run, `undefined` until the plan is read.
	waiting: number | undefined
	// How many of those wait on a person.
	people: number
}

// What stands behind the pool once nothing runs: nothing, only what a person has to decide, or issues
// the run cannot take yet.
function pool_reason(waiting: number, people: number): string {
	if (waiting === 0) return WORDS.pool_empty

	return waiting === people
		? `${String(waiting)} ${WORDS.on_person}`
		: `${String(waiting)} ${WORDS.waiting}`
}

function running_of(running: number): string {
	return `${String(running)} ${WORDS.in_progress}`
}

// Why the run is where it is: the children it runs, else what its plan has left. Nothing before the
// plan is read.
function reason_of(read: NowRead): string | undefined {
	if (read.running > 0) return running_of(read.running)

	return read.waiting === undefined ? undefined : pool_reason(read.waiting, read.people)
}

// `text`, then how long ago `since_ms` was; no time where no event gave one.
function timed(text: string, since_ms: number | undefined, until_ms: number): string {
	return since_ms === undefined ? text : `${text} ${stage_span_of(until_ms - since_ms)}`
}

function with_reason(line: string, read: NowRead): string {
	const reason = reason_of(read)

	return reason === undefined ? line : `${line}${REASON_SEPARATOR}${reason}`
}

// The newest thing an ended run did, aged to its end: an age counting on would read as a hang.
function latest_line(read: NowRead): string {
	const { latest } = read.activity

	return latest === undefined ? '' : timed(latest.text, latest.at_ms, read.ended_ms ?? read.now_ms)
}

// A run with nothing running and at no stage is watching its pool, since the newest thing it did — a
// stage it has left included, so a judgment session's minutes are not counted as watching.
function watch_line(read: NowRead): string {
	const { idle_ms } = read.activity

	if (idle_ms === undefined) return ''

	return with_reason(timed(WORDS.watching, idle_ms, read.now_ms), read)
}

function line_of(read: NowRead): string {
	const { is_stopped, setup, setup_ms } = read.activity

	if (is_stopped) return latest_line(read)
	if (setup !== undefined) return with_reason(timed(setup, setup_ms, read.now_ms), read)

	return read.running > 0 ? running_of(read.running) : watch_line(read)
}

const run_board_now = { line_of }

export { run_board_now }
export type { NowRead }
