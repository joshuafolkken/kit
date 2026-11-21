import { describe, expect, it } from 'vitest'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_repeat, type Pending } from './run-board-sound-repeat'
import type { Cause, SoundSnapshot } from './run-board-sound-transition'

const { REPLAY_AFTER_MS, next_cue } = run_board_sound_repeat

// Lane row #`issue`'s cause for `cue`.
function cause(cue: CueName, issue = 1): Cause {
	return { cue, word: cue, issue }
}

// A frame whose only lane row (#1) holds `cue`, or no row at all.
function frame(cue?: CueName): SoundSnapshot {
	return { rows: new Map(cue === undefined ? [] : [[1, cause(cue)]]), run: new Set() }
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

		heard.push(next.sounding?.cause.cue)
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

		expect(next_cue(held, held, pending, REPLAY_AFTER_MS).sounding?.cause).toStrictEqual({
			cue: 'alert',
			word: 'usage held',
		})
	})

	it('keeps no pending cue for a frame before the layout is read', () => {
		expect(next_cue(undefined, undefined, undefined, 0)).toStrictEqual({
			sounding: undefined,
			pending: undefined,
		})
	})
})

// joshuafolkken/kit#8107: what sounded carries its cause and whether it is the replay.
describe('run_board_sound_repeat.next_cue — the sounding cause', () => {
	it('marks a transition fresh and the ten-minute replay as a repeat of the same cause', () => {
		const opened = next_cue(frame(), frame('alert'), undefined, 0)
		const replayed = next_cue(frame('alert'), frame('alert'), opened.pending, REPLAY_AFTER_MS)

		expect([opened.sounding, replayed.sounding]).toStrictEqual([
			{ cause: cause('alert'), is_repeat: false },
			{ cause: cause('alert'), is_repeat: true },
		])
	})
})

describe('run_board_sound_repeat.next_cue — a second instance of the same cue', () => {
	it('counts ten minutes from a second lane entering the same wait while the first still stands', () => {
		const first: SoundSnapshot = { rows: new Map([[1, cause('human')]]), run: new Set() }
		const both: SoundSnapshot = {
			rows: new Map([
				[1, cause('human')],
				[2, cause('human', 2)],
			]),
			run: new Set(),
		}
		const late = REPLAY_AFTER_MS * 2
		const opened = next_cue(frame(), first, undefined, 0)
		const replayed = next_cue(first, first, opened.pending, REPLAY_AFTER_MS)
		const entered = next_cue(first, both, replayed.pending, late)
		const again = next_cue(both, both, entered.pending, late + REPLAY_AFTER_MS)

		expect([entered.sounding?.cause.issue, again.sounding?.cause.cue]).toStrictEqual([2, 'human'])
	})

	it('names the lane still waiting in the replay once the lane it opened with resolves', () => {
		const second = cause('human', 2)
		const both: SoundSnapshot = {
			rows: new Map([
				[1, cause('human')],
				[2, second],
			]),
			run: new Set(),
		}
		const left: SoundSnapshot = { rows: new Map([[2, second]]), run: new Set() }
		const opened = next_cue(frame(), both, undefined, 0)
		const resolved = next_cue(both, left, opened.pending, 1)
		const replayed = next_cue(left, left, resolved.pending, REPLAY_AFTER_MS)

		expect(replayed.sounding).toStrictEqual({ cause: second, is_repeat: true })
	})
})
