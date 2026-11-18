import { describe, expect, it } from 'vitest'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_repeat, type Pending } from './run-board-sound-repeat'
import type { SoundSnapshot } from './run-board-sound-transition'

const { REPLAY_AFTER_MS, next_cue } = run_board_sound_repeat

// A frame whose only lane row (#1) holds `cue`, or no row at all.
function frame(cue?: CueName): SoundSnapshot {
	return { rows: new Map(cue === undefined ? [] : [[1, cue]]), run: new Set() }
}

interface Tick {
	readonly at_ms: number
	readonly cue?: CueName
}

// Plays the frames in order from an empty one, returning what each frame sounds.
function play(ticks: ReadonlyArray<Tick>): Array<CueName | undefined> {
	let previous = frame()
	let pending: Pending | undefined
	const heard: Array<CueName | undefined> = []

	for (const tick of ticks) {
		const current = frame(tick.cue)
		const next = next_cue(previous, current, pending, tick.at_ms)

		heard.push(next.cue)
		previous = current
		pending = next.pending
	}

	return heard
}

function standing(cue: CueName): Array<Tick> {
	return [
		{ at_ms: 0, cue },
		{ at_ms: REPLAY_AFTER_MS - 1, cue },
		{ at_ms: REPLAY_AFTER_MS, cue },
		{ at_ms: REPLAY_AFTER_MS * 2, cue },
	]
}

describe('run_board_sound_repeat.next_cue — one replay of a standing human or alert cue', () => {
	it('replays a human wait once at ten minutes and not again at twenty (ac-d9df7a68)', () => {
		expect(play(standing('human'))).toStrictEqual(['human', undefined, 'human', undefined])
	})

	it('replays an alert once at ten minutes and not again at twenty (ac-4cac0ec5)', () => {
		expect(play(standing('alert'))).toStrictEqual(['alert', undefined, 'alert', undefined])
	})

	it('counts ten minutes afresh from a state that resolved and came back (ac-69c633ee)', () => {
		const heard = play([
			{ at_ms: 0, cue: 'human' },
			{ at_ms: REPLAY_AFTER_MS - 1 },
			{ at_ms: REPLAY_AFTER_MS, cue: 'human' },
			{ at_ms: REPLAY_AFTER_MS * 2 - 1, cue: 'human' },
			{ at_ms: REPLAY_AFTER_MS * 2, cue: 'human' },
		])

		expect(heard).toStrictEqual(['human', undefined, 'human', undefined, 'human'])
	})

	it('never replays an info cue (ac-11cf268e)', () => {
		expect(play(standing('launch'))).toStrictEqual(['launch', undefined, undefined, undefined])
	})

	it('replays the alert of a run left on hold, read from the run rather than a row', () => {
		const held: SoundSnapshot = { rows: new Map(), run: new Set(['held']) }
		const { pending } = next_cue(held, held, undefined, 0)

		expect(next_cue(held, held, pending, REPLAY_AFTER_MS).cue).toBe('alert')
	})

	it('keeps no pending cue for a frame before the layout is read', () => {
		expect(next_cue(undefined, undefined, undefined, 0)).toStrictEqual({
			cue: undefined,
			pending: undefined,
		})
	})
})

describe('run_board_sound_repeat.next_cue — a second instance of the same cue', () => {
	it('counts ten minutes from a second lane entering the same wait while the first still stands', () => {
		const first: SoundSnapshot = { rows: new Map([[1, 'human']]), run: new Set() }
		const both: SoundSnapshot = {
			rows: new Map([
				[1, 'human'],
				[2, 'human'],
			]),
			run: new Set(),
		}
		const late = REPLAY_AFTER_MS * 2
		const opened = next_cue(frame(), first, undefined, 0)
		const replayed = next_cue(first, first, opened.pending, REPLAY_AFTER_MS)
		const entered = next_cue(first, both, replayed.pending, late)
		const heard = [entered.cue, next_cue(both, both, entered.pending, late + REPLAY_AFTER_MS).cue]

		expect(heard).toStrictEqual(['human', 'human'])
	})
})
