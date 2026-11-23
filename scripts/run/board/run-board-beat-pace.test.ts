import { describe, expect, it } from 'vitest'
import { run_board_beat_pace } from './run-board-beat-pace'
import { run_board_cli } from './run-board-cli'
import { run_board_intro } from './run-board-intro'
import { run_board_intro_fixture } from './run-board-intro-fixture'
import type { Beat } from './run-board-reveal-blocks'

// joshuafolkken/kit#8787: an intro's beats are due by the wall clock, so the time a terminal takes to
// draw a beat never adds to its pause, and a beat already past its end is carried into the next write.

const { listen } = run_board_intro
const { NO_KEYS, clocked } = run_board_intro_fixture
const BEAT_MS = 50
const QUICK_WRITE_MS = 30
const SLOW_WRITE_MS = 120
const TEXTS = ['a', 'b', 'c', 'd']

function beats(): Iterator<Beat> {
	return TEXTS.map((text) => ({ text, ms: BEAT_MS })).values()
}

describe('run_board_beat_pace.scheduled', () => {
	it('dates each beat from the start by the pauses before it', () => {
		const schedule = run_board_beat_pace.scheduled(() => QUICK_WRITE_MS)

		expect(schedule.end(BEAT_MS)).toBe(QUICK_WRITE_MS + BEAT_MS)
		expect(schedule.left(schedule.end(BEAT_MS))).toBe(BEAT_MS + BEAT_MS)
	})

	it('waits each pause in full without a clock', () => {
		const schedule = run_board_beat_pace.scheduled(undefined)

		expect(schedule.left(schedule.end(BEAT_MS))).toBe(BEAT_MS)
	})
})

describe('run_board_intro.listen on the clock', () => {
	it('waits only what is left until the next beat is due', async () => {
		const { written, paused, clock, ports } = clocked(QUICK_WRITE_MS)

		await listen(beats(), ports, NO_KEYS)

		expect(written).toEqual(TEXTS)
		expect(paused).toEqual(TEXTS.map(() => BEAT_MS - QUICK_WRITE_MS))
		expect(clock.at).toBe(TEXTS.length * BEAT_MS)
	})

	it('drops a beat already past its end and always writes the last', async () => {
		const { written, ports } = clocked(SLOW_WRITE_MS)

		await listen(beats(), ports, NO_KEYS)

		expect(written).toEqual(['a', 'c', 'd'])
	})

	it("carries a reveal's late block into the next write", async () => {
		const { written, ports } = clocked(SLOW_WRITE_MS)

		await listen(beats(), ports, NO_KEYS, run_board_beat_pace.appended)

		expect(written).toEqual(['a', 'bc', 'd'])
	})

	it('waits each pause in full where the ports carry no clock', async () => {
		const { written, paused, ports } = clocked(SLOW_WRITE_MS)

		await listen(beats(), { ...ports, intro_now: undefined }, NO_KEYS)

		expect(written).toEqual(TEXTS)
		expect(paused).toEqual(TEXTS.map(() => BEAT_MS))
	})
})

describe('run_board_intro.reveal on the clock', () => {
	it('keeps every block of a frame written too slowly for its beats', async () => {
		const frame = 'ONE  TWO\n\nA  B  C'
		const slow = clocked(SLOW_WRITE_MS)
		const timeless = clocked(SLOW_WRITE_MS)

		await run_board_intro.reveal(frame, slow.ports, NO_KEYS, 'wargames')
		await run_board_intro.reveal(
			frame,
			{ ...timeless.ports, intro_now: undefined },
			NO_KEYS,
			'wargames',
		)

		expect(slow.written.length).toBeLessThan(timeless.written.length)
		expect(slow.written.join('')).toBe(timeless.written.join(''))
	})
})

describe('run_board_cli.LIVE_PORTS.intro_now', () => {
	it('paces the live intro by a clock that moves on', () => {
		const first = run_board_cli.LIVE_PORTS.intro_now?.() ?? 0

		expect(first).toBeGreaterThan(0)
		expect(run_board_cli.LIVE_PORTS.intro_now?.()).toBeGreaterThanOrEqual(first)
	})
})
