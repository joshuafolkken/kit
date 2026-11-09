import { stripVTControlCharacters } from 'node:util'
import { poll } from '#scripts/lib/poll'
import type { LocalRead } from './run-board-read'
import type { BoardPorts } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// The chat frame `run:board --chat` answers with, and `--every <minutes>`, which pushes that same frame
// off-screen on a schedule with no model in between. The frame needs no model, so a plain background
// process sends it and ends with the run, rather than a scheduled session re-reading its whole context.

const { FRESH_STATE, tick } = run_board_tick

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
async function push_one(ports: BoardPorts, followed: Followed): Promise<boolean> {
	const { text, local } = await chat_frame(ports)

	if (local === undefined) return false

	followed.started_ms ??= local.started_ms

	if (local.started_ms !== followed.started_ms) return false

	await ports.push(text)

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

const run_board_every = { chat_frame, push_until_ended }

export { run_board_every }
