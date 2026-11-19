import terminalLink from 'terminal-link'
import { z } from 'zod'
import { run_board_data } from './run-board-data'
import { run_board_every, type RecordPorts } from './run-board-every'
import { run_board_frame_store } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import type { RoundState } from './run-board-gather-thread'
import { run_board_state, type BoardPorts, type BoardState } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'

// The frames `--chat` and `--once` answer from, recorded on the live board's worker thread
// (joshuafolkken/kit#8161): the worker draws them from each round it gathers, so the board's own
// thread only draws the screen. What the board's terminal decides — its theme, whether it is one and
// whether it opens links — is handed to the worker as it starts, since the worker writes to no terminal.

const FORCE_HYPERLINK = 'FORCE_HYPERLINK'

// What the worker records with, read off the board's terminal.
interface RecordSetup {
	theme: Theme | undefined
	is_tty: boolean
	is_linked: boolean
}

const setup_schema = z.object({
	theme: z.enum(run_board_theme.THEMES).optional(),
	is_tty: z.boolean(),
	is_linked: z.boolean(),
})

// joshuafolkken/kit#8242: every link opens with the same `id=`. A terminal keying links by id and URL
// (xterm.js, VSCode's) then keeps one record per URL however many frames redraw it; an id-less link is
// a new record each frame, piled up on the alternate screen and dropped at once on leaving it — seconds
// of a frozen terminal after a long-running board. `terminal-link` takes no id, so it is put into the
// opening `8;;<url>` that `terminal-link` writes, tmux's wrapping included.
const LINK_OPEN = '8;;'
const LINK_OPEN_WITH_ID = '8;id=josh-run-board;'

// No fallback: a terminal that opens no link, or a pipe, gets the bare number rather than a URL.
function link(text: string, url: string): string {
	const linked = terminalLink(text, url, { fallback: false })

	return linked.replace(`${LINK_OPEN}${url}`, () => `${LINK_OPEN_WITH_ID}${url}`)
}

function setup_of(theme: Theme | undefined): RecordSetup {
	return { theme, is_tty: process.stdout.isTTY, is_linked: terminalLink.isSupported }
}

// What a worker is started with (`run-board-gather-thread.ts` → `WorkerSeed`).
const start_schema = z.object({ seed: z.unknown(), setup: setup_schema.optional() })

// The worker's start read back: the seed, and the recorder its setup builds — none for a start that
// carries no setup.
interface WorkerStart {
	seed: unknown
	record: ((round: RoundState) => void) | undefined
}

// The worker's environment: `link` there reads the worker's own output, never a terminal, so whether
// the board's terminal opens links is forced to its answer.
function worker_environment(setup: RecordSetup): NodeJS.ProcessEnv {
	return { ...process.env, [FORCE_HYPERLINK]: setup.is_linked ? '1' : '0' }
}

// The board's state over a round, as the board receives it (`run-board-gather-thread.ts`), with no view
// of its own: the frame recorded is the single frame `--once` draws from scratch.
function state_of(round: RoundState): BoardState {
	const read = run_board_gather.read_of(round.gather)

	return {
		...run_board_state.FRESH_VIEW,
		...run_board_data.received(run_board_data.posted(round.data), read),
	}
}

function record_ports(setup: RecordSetup, ports: Pick<BoardPorts, 'now' | 'frames'>): RecordPorts {
	return {
		...ports,
		link,
		is_tty: setup.is_tty,
		form: 'screen',
		is_themed: setup.theme !== undefined,
	}
}

// What the worker calls after each round: its frames recorded every `RECORD_EVERY_MS`
// (`run-board-every.ts`).
function round_recorder(
	setup: RecordSetup,
	ports: Pick<BoardPorts, 'now' | 'frames'>,
): (round: RoundState) => void {
	const record = run_board_every.recorder(record_ports(setup, ports), setup.theme)

	return (round) => {
		record(state_of(round))
	}
}

// The worker's recorder, writing to the frame files `--chat` and `--once` read.
function live_recorder(setup: RecordSetup): (round: RoundState) => void {
	return round_recorder(setup, {
		now: () => Date.now(),
		frames: run_board_frame_store.file_store(),
	})
}

function started_with(given: unknown): WorkerStart {
	const parsed = start_schema.safeParse(given)

	if (!parsed.success) return { seed: undefined, record: undefined }
	const { seed, setup } = parsed.data
	const record = setup === undefined ? undefined : live_recorder({ ...setup, theme: setup.theme })

	return { seed, record }
}

const run_board_gather_record = {
	link,
	round_recorder,
	setup_of,
	started_with,
	worker_environment,
}

export { run_board_gather_record }
export type { RecordSetup }
