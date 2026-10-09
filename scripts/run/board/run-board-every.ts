import { stripVTControlCharacters } from 'node:util'
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

// One frame in the chat's form, with every escape stripped because a chat shows them as text.
async function chat_frame(ports: BoardPorts): Promise<ChatFrame> {
	let text = ''
	const chat_ports: BoardPorts = {
		...ports,
		is_tty: false,
		size: undefined,
		form: 'chat',
		write: (frame) => {
			text += stripVTControlCharacters(frame)
		},
	}
	const { local } = await tick(FRESH_STATE, chat_ports)

	return { text, local }
}

// Pushes one frame, answering whether the run is still going: no run sends nothing, and an ended run's
// frame is the last one sent.
async function push_one(ports: BoardPorts): Promise<boolean> {
	const { text, local } = await chat_frame(ports)

	if (local === undefined) return false

	await ports.push(text)

	return local.ended_ms === undefined
}

async function push_until_ended(ports: BoardPorts, interval_ms: number): Promise<void> {
	let is_running = await push_one(ports)

	while (is_running) {
		// eslint-disable-next-line no-await-in-loop -- polling: each push waits out the interval
		await ports.sleep(interval_ms)
		// eslint-disable-next-line no-await-in-loop -- polling: each push reads the run afresh
		is_running = await push_one(ports)
	}
}

const run_board_every = { chat_frame, push_until_ended }

export { run_board_every }
