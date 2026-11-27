import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_frame_loop } from './run-board-frame-loop'

// joshuafolkken/kit#8936: the rules a theme's motion keeps frame by frame, so a stutter fails the gate
// rather than waiting for someone to see it in a recording. A frame is written once, in one synchronized
// block; it writes no more than its changed cells cost, and not more and more for no more cells; and a
// terminal slow to take a frame moves no frame further than one refresh off when it was due.

const { MIN_FRAME_MS } = run_board_frame_loop
const { is_synced_once } = run_board_frame_fixture
// The most UTF-16 units one changed cell may cost: a cursor move, a 24-bit foreground and background
// with their attributes, and a wide character.
const CELL_UNITS = 64
// What a frame costs beyond its cells: its synchronized block's two marks.
const FRAME_UNITS = 16
// How many frames in a row may each write more than the last for no more changed cells.
const GROWTH_RUN = 8
// joshuafolkken/kit#9069: an OSC 8 link mark, opener or closer. Its length follows its URL, not the
// cells it covers, so it is budgeted as written rather than as part of `CELL_UNITS`.
const ESC = '\u{1B}'
const BEL = '\u{7}'
const LINK_MARK = new RegExp(String.raw`${ESC}\]8;[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\)`, 'gu')

// A frame as the terminal took it: when it was made, its writes, and how many cells they changed.
interface MotionFrame {
	at_ms: number
	writes: ReadonlyArray<string>
	changed: number
}

// A replay checked: what it was (its theme, size and scene), its frames, and when each frame was made
// where writing took no time — when each was due.
interface MotionRun {
	label: string
	frames: ReadonlyArray<MotionFrame>
	due_ms: ReadonlyArray<number>
}

type Rule = 'one-write' | 'cell-budget' | 'growth' | 'cadence'

interface Failure {
	frame: number
	rule: Rule
	detail: string
}

function units_of(frame: MotionFrame): number {
	return frame.writes.reduce((total, write) => total + write.length, 0)
}

// One write a frame, all of it inside one synchronized block.
function write_failures(frame: MotionFrame, index: number): Array<Failure> {
	const count = frame.writes.length

	if (count > 1) return [{ frame: index, rule: 'one-write', detail: `${String(count)} writes` }]
	if (frame.writes.every((write) => is_synced_once(write))) return []

	return [{ frame: index, rule: 'one-write', detail: 'written outside one synchronized block' }]
}

// The units the frame's link marks take.
function link_units_of(frame: MotionFrame): number {
	return frame.writes.reduce(
		(total, write) => total + [...write.matchAll(LINK_MARK)].join('').length,
		0,
	)
}

function budget_failures(frame: MotionFrame, index: number): Array<Failure> {
	const units = units_of(frame)
	const budget = FRAME_UNITS + frame.changed * CELL_UNITS + link_units_of(frame)

	if (units <= budget) return []
	const detail = `${String(units)} units for ${String(frame.changed)} changed cells, over ${String(budget)}`

	return [{ frame: index, rule: 'cell-budget', detail }]
}

// Whether the frame at `index` wrote more than the one before it for no more changed cells.
function is_grown(frames: ReadonlyArray<MotionFrame>, index: number): boolean {
	const before = frames[index - 1]
	const frame = frames[index]

	if (before === undefined || frame === undefined) return false

	return units_of(frame) > units_of(before) && frame.changed <= before.changed
}

// The frame each run of `GROWTH_RUN` grown frames reaches its length at.
function growth_failures(frames: ReadonlyArray<MotionFrame>): Array<Failure> {
	const runs: Array<number> = []
	const detail = `${String(GROWTH_RUN)} frames each writing more for no more changed cells`

	for (const index of frames.keys()) runs.push(is_grown(frames, index) ? (runs.at(-1) ?? 0) + 1 : 0)

	return [...runs.entries()]
		.filter(([, run]) => run === GROWTH_RUN)
		.map(([frame]) => ({ frame, rule: 'growth', detail }))
}

// Whether a frame was made at all, when it was due, or within the one refresh after.
function is_on_time(at_ms: number | undefined, due_ms: number | undefined): boolean {
	if (at_ms === undefined || due_ms === undefined) return false

	return at_ms >= due_ms && at_ms < due_ms + MIN_FRAME_MS
}

function time_text(ms: number | undefined): string {
	return ms === undefined ? 'none' : `${String(ms)} ms`
}

// The first frame made off when it was due, or due and never made; the frames after follow from it.
function cadence_failures(
	at_ms: ReadonlyArray<number>,
	due_ms: ReadonlyArray<number>,
): Array<Failure> {
	const indices = Array.from({ length: Math.max(at_ms.length, due_ms.length) }, (_, index) => index)
	const frame = indices.find((index) => !is_on_time(at_ms[index], due_ms[index]))

	if (frame === undefined) return []
	const detail = `made at ${time_text(at_ms[frame])}, due at ${time_text(due_ms[frame])}`

	return [{ frame, rule: 'cadence', detail }]
}

// Every rule `run` breaks: its label, the frame (counted among the frames that wrote), the rule's name
// and what broke it.
function motion_failures(run: MotionRun): Array<string> {
	const frames = run.frames.filter(({ writes }) => writes.length > 0)
	const failures = [
		...frames.flatMap((frame, index) => write_failures(frame, index)),
		...frames.flatMap((frame, index) => budget_failures(frame, index)),
		...growth_failures(frames),
		...cadence_failures(
			frames.map(({ at_ms }) => at_ms),
			run.due_ms,
		),
	]

	return failures.map(
		({ frame, rule, detail }) => `${run.label} frame ${String(frame)}: ${rule} — ${detail}`,
	)
}

const run_board_motion_check_fixture = { CELL_UNITS, GROWTH_RUN, motion_failures }

export { run_board_motion_check_fixture }
export type { MotionFrame, MotionRun }
