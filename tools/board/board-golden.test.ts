import { run_board_fixture } from '#scripts/run/board/run-board-fixture'
import { run_board_replay } from '#scripts/run/board/run-board-replay'
import type { Beat } from '#scripts/run/board/run-board-reveal-blocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { board_golden, type GoldenTheme } from './board-golden'

const { LOCAL, harness, plan_titled } = run_board_fixture
const { THEMES, beat_at, is_update, read_golden, replay_argv, verdict, write_golden } = board_golden
// A replay of the bttf arrival and both theme openings runs past the default 5 s.
const REPLAY_TIMEOUT_MS = 120_000
const MOVED_CELL = '\u{1B}[1;1HZ'

async function replayed(theme: GoldenTheme): Promise<Array<Beat>> {
	const options = run_board_replay.options_of(replay_argv(theme), process.env)

	if (options === undefined) throw new Error(`refused: ${theme}`)
	const { ports } = harness(LOCAL, [plan_titled('a')])

	return await run_board_replay.replay(ports, options)
}

async function golden(theme: GoldenTheme): Promise<Array<Beat>> {
	const beats = await read_golden(theme)

	if (beats === undefined) throw new Error(`no golden beats: ${theme}`)

	return beats
}

// The golden with one cell overwritten at the end of the beat in the middle.
function moved(beats: ReadonlyArray<Beat>): { beats: Array<Beat>; index: number } {
	const index = Math.floor(beats.length / 2)
	const changed = beats.map((beat, at) =>
		at === index ? { ...beat, text: `${beat.text}${MOVED_CELL}` } : beat,
	)

	return { beats: changed, index }
}

beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
	vi.stubEnv('JOSH_BOARD_ICONS', undefined)
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
	vi.stubEnv('TZ', 'UTC')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('board_golden replay', () => {
	it.each(THEMES)(
		'draws the recorded golden screens beat for beat for %s (ac-9ec6603b, ac-cfde4c0f)',
		async (theme) => {
			const actual = await replayed(theme)

			if (is_update(process.env)) await write_golden(theme, actual)

			expect(await verdict(await golden(theme), actual)).toBeUndefined()
		},
		REPLAY_TIMEOUT_MS,
	)
})

describe('board_golden.verdict', () => {
	it(
		'fails a replay with one cell moved, naming the beat and how to record again (ac-c7d8e264)',
		async () => {
			const expected = await golden('bttf')
			const { beats, index } = moved(expected)
			const text = await verdict(expected, beats)

			expect(text).toContain('board:compare — diverged at')
			expect(text).toContain('1 differences')
			expect(text).toContain(`beat ${String(index)} of ${String(beats.length)}`)
			expect(text).toContain('BOARD_GOLDEN_UPDATE=1')
		},
		REPLAY_TIMEOUT_MS,
	)

	it('fails a replay that stops before the golden does', async () => {
		const expected: Array<Beat> = [
			{ text: 'a', ms: 10 },
			{ text: 'b', ms: 0 },
		]
		const text = await verdict(expected, expected.slice(0, 1))

		expect(text).toContain('the golden has 2 beats, the replay 1')
	})
})

describe('board_golden.beat_at', () => {
	it('names the last beat written at or before the moment', () => {
		const beats: Array<Beat> = [
			{ text: 'a', ms: 50 },
			{ text: 'b', ms: 0 },
			{ text: 'c', ms: 50 },
		]

		const moments = [0, 49, 50, 99]

		expect(moments.map((at_ms) => beat_at(beats, at_ms))).toEqual([0, 0, 2, 2])
	})
})
