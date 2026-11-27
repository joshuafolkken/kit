import { describe, expect, it } from 'vitest'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'
import { run_board_sound_wopr } from './run-board-sound-wopr'
import { run_board_theme_wopr_notice } from './run-board-theme-wopr-notice'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'

// joshuafolkken/kit#9137: the wopr theme's own voices, each checked by its waveform — the lock's two
// notes, and the tic-tac-toe beeps on the moves of the NOTICE build's games and of a ROW's.

const { BUILD_GAP_TICKS, LOCK_HIGH, LOCK_LOW, build_cues, notice_cues, row_beats } =
	run_board_sound_wopr
const { SAMPLE_RATE } = run_board_sound_shape
const { sample_at, sound_samples } = run_board_sound_voice
const { notice_pace } = run_board_theme_wopr_notice
const { game_at } = run_board_theme_wopr_panel
const MS_PER_SECOND = 1000
const RADIANS_PER_CYCLE = Math.PI + Math.PI
const TICK_MS = 50
const HIGH_HZ = 640
const LOW_HZ = 275
const EDGE_MS = 30

function ms_of(samples: { length: number }): number {
	return (samples.length * MS_PER_SECOND) / SAMPLE_RATE
}

// How strongly `samples` sound at `hz`: their projection on a sine and a cosine of that pitch.
function level_at(samples: ReadonlyArray<number>, hz: number): number {
	let sine = 0
	let cosine = 0

	for (const [index, value] of samples.entries()) {
		const angle = (RADIANS_PER_CYCLE * hz * index) / SAMPLE_RATE

		sine += value * Math.sin(angle)
		cosine += value * Math.cos(angle)
	}

	return Math.hypot(sine, cosine) / samples.length
}

// The loudest sample from `from_ms` to `to_ms`.
function top_of(samples: ReadonlyArray<number>, from_ms: number, to_ms: number): number {
	const span = samples.slice(sample_at(from_ms), sample_at(to_ms))
	let top = 0

	for (const value of span) top = Math.max(top, Math.abs(value))

	return top
}

// Whether a beep is the high note or the low one, by the pitch it sounds more of.
function pitch_of(sound: Sound): number {
	const samples = sound_samples(sound)

	return level_at(samples, HIGH_HZ) > level_at(samples, LOW_HZ) ? HIGH_HZ : LOW_HZ
}

function gaps_of(times: ReadonlyArray<number>): Array<number> {
	return times.slice(1).map((at_ms, index) => at_ms - (times[index] ?? 0))
}

// Whether the NOTICE panel's game shows more marks, or a new game, on `tick` than the tick before.
function is_move(tick: number): boolean {
	const now = game_at(tick, notice_pace)
	const before = game_at(tick - 1, notice_pace)

	return now.phase === 'play' && (now.game !== before.game || now.marks !== before.marks)
}

describe('run_board_sound_wopr the lock’s notes', () => {
	const high = sound_samples(LOCK_HIGH)
	const low = sound_samples(LOCK_LOW)

	it('lasts the high note 190 ms and the low note 250 ms, each at 0.11', () => {
		expect([ms_of(high), ms_of(low)]).toStrictEqual([190, 250])
		expect([LOCK_HIGH.peak, LOCK_LOW.peak]).toStrictEqual([0.11, 0.11])
	})

	it('sounds the high note at 640 Hz with odd harmonics 15 and 26 dB under it', () => {
		const base = level_at(high, 640)

		expect(level_at(high, 1923) / base).toBeCloseTo(10 ** (-15 / 20), 1)
		expect(level_at(high, 3206) / base).toBeCloseTo(10 ** (-26 / 20), 1)
		expect(level_at(high, 274) / base).toBeLessThan(0.1)
	})

	it('sounds the low note at 274 Hz with odd harmonics 19 and 27 dB under it', () => {
		const base = level_at(low, 274)

		expect(level_at(low, 824) / base).toBeCloseTo(10 ** (-19 / 20), 1)
		expect(level_at(low, 1374) / base).toBeCloseTo(10 ** (-27 / 20), 1)
		expect(level_at(low, 640) / base).toBeLessThan(0.1)
	})

	it('strikes the high note and lets it die away, and holds the low note flat', () => {
		const high_end = top_of(high, 190 - EDGE_MS, 190) / top_of(high, 0, EDGE_MS)
		const low_end = top_of(low, 250 - EDGE_MS, 250) / top_of(low, 0, EDGE_MS)

		expect(high_end).toBeLessThan(0.35)
		expect(low_end).toBeGreaterThan(0.95)
	})

	it('plays the high note as the tenth position locks and the low note 450 ms after', () => {
		const cues = notice_cues()

		expect(cues.filter(({ sound }) => sound === LOCK_HIGH).map(({ at_ms }) => at_ms)).toStrictEqual(
			[2500],
		)
		expect(cues.filter(({ sound }) => sound === LOCK_LOW).map(({ at_ms }) => at_ms)).toStrictEqual([
			2950,
		])
	})
})

describe('run_board_sound_wopr the NOTICE build’s beeps', () => {
	const cues = build_cues()
	const times = cues.map(({ at_ms }) => at_ms)
	// The build's games as the panel plays them: a burst of beeps a game, the games ever shorter.
	const GAMES = [
		[0, 100, 200, 300, 400],
		[650, 750, 850],
		[1100, 1200, 1300],
		...[1550, 1900, 2250, 2600, 2950, 3300, 3650].map((start) => [start, start + 100]),
	]

	it('beeps from the build’s first move to before the peak, a burst a game', () => {
		expect(times).toStrictEqual(GAMES.flat())
		expect(Math.max(...times)).toBeLessThan(4000)
	})

	it('lands every beep on a tick the panel’s game puts marks down, two ticks apart or more', () => {
		const idle = times.filter((at_ms) => !is_move(at_ms / TICK_MS))

		expect(idle).toStrictEqual([])
		expect(Math.min(...gaps_of(times))).toBe(BUILD_GAP_TICKS * TICK_MS)
	})

	it('starts each game on the high note and alternates', () => {
		const expected = GAMES.flatMap((game) =>
			game.map((_, beep) => (beep % 2 === 0 ? HIGH_HZ : LOW_HZ)),
		)

		expect(cues.map(({ sound }) => pitch_of(sound))).toStrictEqual(expected)
	})

	it('fits each beep into its interval, at 0.04', () => {
		const lengths = new Set(cues.map(({ sound }) => ms_of(sound_samples(sound))))

		expect([...lengths]).toStrictEqual([80])
		expect(cues.every(({ sound }) => sound.peak === 0.04)).toBe(true)
	})
})

describe('run_board_sound_wopr a ROW’s beats', () => {
	const LETTERS = 100
	const beats = row_beats(LETTERS)

	// A game is nine moves four ticks apart, then four ticks of flash and blank; the first move of the
	// first game is the ROW's start note.
	it('beeps on every move of the game beside the code', () => {
		const ticks = Array.from({ length: LETTERS }, (_, tick) => tick)
		const moves = ticks.filter((tick) => tick > 0 && tick % 40 < 36 && (tick % 40) % 4 === 0)

		expect(beats.map(({ at_ms }) => at_ms)).toStrictEqual(moves.map((tick) => tick * 50))
	})

	it('sounds O low and X high, each game starting on X', () => {
		const pitches = new Map(beats.map(({ at_ms, sound }) => [at_ms, pitch_of(sound)]))

		expect([200, 400, 600].map((at_ms) => pitches.get(at_ms))).toStrictEqual([
			LOW_HZ,
			HIGH_HZ,
			LOW_HZ,
		])
		expect([1600, 2000, 2200].map((at_ms) => pitches.get(at_ms))).toStrictEqual([
			HIGH_HZ,
			HIGH_HZ,
			LOW_HZ,
		])
	})

	it('has none for a row shorter than a move', () => {
		expect(row_beats(4)).toStrictEqual([])
	})
})
