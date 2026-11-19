import { stripVTControlCharacters } from 'node:util'
import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_frame_store } from './run-board-frame-store'
import type { LocalRead } from './run-board-read'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw, type DrawPorts } from './run-board-tick-draw'

// The chat frame `run:board --chat` answers with, and `--every <minutes>`, which pushes that same frame
// off-screen on a schedule with no model in between. The frame needs no model, so a plain background
// process sends it and ends with the run, rather than a scheduled session re-reading its whole context.
// The live board's worker thread and `--every` record the frames they hold, so `--chat` and `--once`
// answer from them.

const { FRESH_STATE, layout_for, tick } = run_board_tick
const { draw_run } = run_board_tick_draw
const { CHAT_KEY, once_key } = run_board_frame_store
const RECORD_EVERY_SECONDS = 5
const RECORD_EVERY_MS = RECORD_EVERY_SECONDS * MS_PER_SECOND

// What a frame is recorded through: the draw's ports, the clock and the store — no read.
type RecordPorts = Omit<DrawPorts, 'write'> & Pick<BoardPorts, 'now' | 'frames'>

interface ChatFrame {
	text: string
	// The run the frame drew; `undefined` when none has started here.
	local: LocalRead | undefined
}

// One frame in the chat's form, with every escape stripped because a chat shows them as text. The
// reviewers are thanked on the terminal's board alone, so the chat reads no roster.
async function chat_frame(ports: BoardPorts): Promise<ChatFrame> {
	let text = ''
	const chat_ports: BoardPorts = {
		...ports,
		is_tty: false,
		size: undefined,
		form: 'chat',
		read_thanks: undefined,
		write: (frame) => {
			text += stripVTControlCharacters(frame)
		},
	}
	const { local } = await tick(FRESH_STATE, chat_ports)

	return { text, local }
}

// The run the pushes follow: the start of the first one drawn, `undefined` before any is.
interface Followed {
	started_ms: number | undefined
}

// Pushes one frame, answering whether the run is still going: no run sends nothing, and an ended run's
// frame is the last one sent. A frame drawing another run than the first — an older run's end screen
// once a single run's hold is released — sends nothing and ends the pushes too.
// The pushed frame is recorded, dated when its read began, as `--chat` records its own.
async function push_one(ports: BoardPorts, followed: Followed): Promise<boolean> {
	const saved_ms = ports.now()
	const { text, local } = await chat_frame(ports)

	if (local === undefined) return false

	followed.started_ms ??= local.started_ms

	if (local.started_ms !== followed.started_ms) return false

	await ports.push(text)
	ports.frames?.save(CHAT_KEY, { text, saved_ms })

	return local.ended_ms === undefined
}

async function push_until_ended(ports: BoardPorts, interval_ms: number): Promise<void> {
	const followed: Followed = { started_ms: undefined }

	await poll.poll_until(async () => !(await push_one(ports, followed)), {
		attempts: Infinity,
		interval_ms,
		sleeper: ports.sleep,
	})
}

// The text of the run a live board already read, drawn in the ports' form as a single frame is: nothing
// read, sounded or typed, and nothing fitted to the terminal.
function redrawn(
	state: BoardState,
	local: LocalRead,
	ports: Omit<DrawPorts, 'write'>,
	now_ms: number,
): string {
	let text = ''
	const quiet: DrawPorts = {
		...ports,
		is_tty: false,
		size: undefined,
		footer: undefined,
		folded: undefined,
		cue: undefined,
		types_rows: false,
		write: (frame) => {
			text += frame
		},
	}

	// A single frame counts arrivals from its own total, never from the live board's first one.
	const single = { ...state, baseline_total: undefined }

	draw_run(single, local, { ports: quiet, now_ms }, layout_for(single, local, now_ms))

	return text
}

// When the run's plan the state draws was asked for — the oldest read in the frame, so its record is
// dated then. `undefined` until this run's first plan read has settled: before it, the frame holds
// only the run's own children, which `--chat` and `--once` wait past.
function read_ms(state: BoardState): number | undefined {
	return state.fetched_ms ?? state.failed_ms
}

// Records the chat's frame and the single frame `--once` draws on this terminal in the theme, both
// from the live board's last state and dated when its plan was read; the chat thanks nobody.
function record(
	state: BoardState,
	ports: RecordPorts,
	theme: Theme | undefined,
	now_ms: number,
): void {
	const { local } = state
	const saved_ms = read_ms(state)

	if (local === undefined || saved_ms === undefined) return
	const chat = redrawn({ ...state, thanks: [] }, local, { ...ports, form: 'chat' }, now_ms)
	const once = run_board_theme.restyle(theme, redrawn(state, local, ports, now_ms))

	ports.frames?.save(CHAT_KEY, { text: stripVTControlCharacters(chat), saved_ms })
	ports.frames?.save(once_key(theme, ports.is_tty), { text: once, saved_ms })
}

// What a live board's worker thread calls after each round (`run-board-gather-record.ts`): records its
// frames at most once every `RECORD_EVERY_MS`, from the first state whose plan read has settled. Drawn
// in place, they take no read, and the store writes them without being awaited, so the next round waits
// on neither.
function recorder(ports: RecordPorts, theme: Theme | undefined): (state: BoardState) => void {
	let next_ms = -Infinity

	return (state) => {
		const now_ms = ports.now()

		if (ports.frames === undefined || read_ms(state) === undefined || now_ms < next_ms) return
		next_ms = now_ms + RECORD_EVERY_MS
		record(state, ports, theme, now_ms)
	}
}

const run_board_every = { RECORD_EVERY_MS, chat_frame, push_until_ended, record, recorder }

export { run_board_every }
export type { RecordPorts }
