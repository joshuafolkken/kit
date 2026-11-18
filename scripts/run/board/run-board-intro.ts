import type { KeyReading } from './run-board-keys'
import type { BoardPorts, Pace } from './run-board-state'

// The line a live board types before its first frame, a letter at a time, then holds — the first
// frame's read runs meanwhile, and the frame is drawn over the line once both are done. A key skips
// the rest; the key is spent on the skip, not on a fold.

const LINE = 'SHALL WE PLAY A GAME?'
const LETTER_MS = 50
const HOLD_MS = 2000

interface Beat {
	text: string
	ms: number
}

type IntroPorts = Pick<BoardPorts, 'intro_sleep' | 'write'>

const BEATS: ReadonlyArray<Beat> = [
	...Array.from(LINE, (letter) => ({ text: letter, ms: LETTER_MS })),
	{ text: '', ms: HOLD_MS },
]

// Each beat written, then its pause raced against the skip; a skip writes no further beat.
async function beat_through(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts & { intro_sleep: (ms: number) => Promise<void> },
	skip: { pressed: Promise<undefined>; is_pressed: () => boolean },
): Promise<void> {
	const [beat, ...rest] = beats
	if (beat === undefined || skip.is_pressed()) return

	ports.write(beat.text)
	await Promise.race([ports.intro_sleep(beat.ms), skip.pressed])
	await beat_through(rest, ports, skip)
}

// Played only where the ports carry its pauses; the key it listens for goes back to folding once it ends.
async function play(ports: IntroPorts, keys: KeyReading): Promise<void> {
	const { intro_sleep } = ports
	if (intro_sleep === undefined) return

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
		await beat_through(BEATS, { ...ports, intro_sleep }, skip)
	} finally {
		held.release?.()
	}
}

// The first read starts at once, but returns only once the intro is over; every later read is untouched.
function after<Read>(
	gather: (pace: Pace) => Promise<Read>,
	intro: Promise<void>,
): (pace: Pace) => Promise<Read> {
	let is_first = true

	return async (pace) => {
		if (!is_first) return await gather(pace)
		is_first = false
		const [read] = await Promise.all([gather(pace), intro])

		return read
	}
}

const run_board_intro = { HOLD_MS, LETTER_MS, LINE, after, play }

export { run_board_intro }
export type { IntroPorts }
