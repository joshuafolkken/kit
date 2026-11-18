import type { KeyReading } from './run-board-keys'
import type { BoardPorts, Pace } from './run-board-state'
import { run_board_typing } from './run-board-typing'

// The line a live board types before its first frame, a letter at a time with a block cursor after
// the last letter typed, then holds without the cursor — the first frame's read runs meanwhile, and the
// frame is drawn over the line once both are done. A key skips the rest; the key is spent on the skip,
// not on a fold. Each beat rewrites the whole line, so the screen always matches the beat last written.

const LINE = 'SHALL WE PLAY A GAME?'
const LETTER_MS = 50
const HOLD_MS = 2000
const REVEAL_LINE_MS = 50
const LINE_START = '\r'
const ERASE_LINE_END = '\u{1B}[K'

interface Beat {
	text: string
	ms: number
}

type IntroPorts = Pick<BoardPorts, 'intro_sleep' | 'write'>

const BEATS: ReadonlyArray<Beat> = [
	...Array.from(LINE, (_letter, index) => ({
		text: `${LINE_START}${run_board_typing.typed(LINE, LINE.slice(0, index + 1))}${ERASE_LINE_END}`,
		ms: LETTER_MS,
	})),
	{ text: '', ms: HOLD_MS },
]

// Each beat written, then its pause raced against the skip; a skip writes no further beat, and the
// beats left unwritten are handed back.
async function beat_through(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts & { intro_sleep: (ms: number) => Promise<void> },
	skip: { pressed: Promise<undefined>; is_pressed: () => boolean },
): Promise<ReadonlyArray<Beat>> {
	const [beat, ...rest] = beats
	if (beat === undefined || skip.is_pressed()) return beats

	ports.write(beat.text)
	await Promise.race([ports.intro_sleep(beat.ms), skip.pressed])

	return await beat_through(rest, ports, skip)
}

// Beats played only where the ports carry their pauses, the beats left unwritten handed back; the key
// listened for goes back to folding once they end.
async function listen(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts,
	keys: KeyReading,
): Promise<ReadonlyArray<Beat>> {
	const { intro_sleep } = ports
	if (intro_sleep === undefined) return beats

	const held: { is_pressed: boolean; release: (() => void) | undefined } = {
		is_pressed: false,
		release: undefined,
	}
	const pressed = new Promise<undefined>((resolve) => {
		held.release = keys.intercept?.(() => {
			held.is_pressed = true
			resolve(undefined)
		})
	})
	const skip = { pressed, is_pressed: (): boolean => held.is_pressed }

	try {
		return await beat_through(beats, { ...ports, intro_sleep }, skip)
	} finally {
		held.release?.()
	}
}

async function play(ports: IntroPorts, keys: KeyReading): Promise<void> {
	await listen(BEATS, ports, keys)
}

// The first frame written a line at a time from the top, each line a beat; the lines a key leaves
// unwritten are written at once, as is the whole frame where the ports carry no pauses.
async function reveal(frame: string, ports: IntroPorts, keys: KeyReading): Promise<void> {
	const beats = frame.split('\n').map((line, index) => ({
		text: index === 0 ? line : `\n${line}`,
		ms: REVEAL_LINE_MS,
	}))
	const rest = await listen(beats, ports, keys)

	if (rest.length > 0) ports.write(rest.map((beat) => beat.text).join(''))
}

// The first read starts at once, but returns or throws only once the intro is over, so a failed read
// never leaves the line typing over the board's exit; every later read is untouched.
function after<Read>(
	gather: (pace: Pace) => Promise<Read>,
	intro: Promise<void>,
): (pace: Pace) => Promise<Read> {
	let is_first = true

	return async (pace) => {
		if (!is_first) return await gather(pace)
		is_first = false
		const read = gather(pace)

		await Promise.allSettled([read, intro])
		await intro

		return await read
	}
}

const run_board_intro = {
	ERASE_LINE_END,
	HOLD_MS,
	LETTER_MS,
	LINE,
	LINE_START,
	REVEAL_LINE_MS,
	after,
	play,
	reveal,
}

export { run_board_intro }
export type { IntroPorts }
