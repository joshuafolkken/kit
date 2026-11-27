import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'

const { state_at } = run_board_theme_wopr_fixture
const POOLS = ['0123456789', run_board_theme_wopr_led.LETTER_POOL]
const {
	EFFECT_END,
	code_char,
	cooled_of,
	count,
	cycled,
	is_notice,
	is_progress,
	is_row,
	level_of,
	mixed,
	seconds,
} = run_board_theme_wopr_phase

describe('run_board_theme_wopr_phase', () => {
	it('mixes the same values to the same number in Park–Miller range', () => {
		expect(mixed([3, 4])).toBe(mixed([3, 4]))
		expect(mixed([3, 4])).not.toBe(mixed([4, 3]))
		expect(mixed([3, 4])).toBeLessThan(2_147_483_647)
	})

	it('draws launch code from the code alphabet', () => {
		expect('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789').toContain(code_char(1, 2, 3))
	})

	it('holds DEFCON at 5 idle, 4 while a lane types, and 1 at the peak', () => {
		expect(level_of(state_at('i', 50))).toBe(5)
		expect(is_row(state_at('r', 12))).toBe(true)
		expect(level_of(state_at('r', 12))).toBe(4)
		expect(level_of(state_at('n', 89))).toBe(1)
	})

	it('plays the NOTICE until EFFECT_END ticks after the peak', () => {
		expect(is_notice(state_at('n', 89 + EFFECT_END - 1))).toBe(true)
		expect(is_notice(state_at('n', 89 + EFFECT_END + 1))).toBe(false)
	})

	it('plays the PROGRESS strip while the now line types', () => {
		expect(is_progress(state_at('p', 12))).toBe(true)
		expect(is_progress(state_at('i', 12))).toBe(false)
	})

	it('cools the rules from no row typed, and holds them in code while one types', () => {
		expect(cooled_of(state_at('i', 50))).toBe(Infinity)
		expect(cooled_of(state_at('r', 12))).toBe(-1)
	})

	it('writes counts in two digits and ticks as seconds', () => {
		expect(count(7)).toBe('07')
		expect(seconds(79)).toBe('03.95')
		expect(seconds(-3)).toBe('00.00')
	})
})

// joshuafolkken/kit#9137: a code character changes on every tick.
describe('run_board_theme_wopr_phase.cycled', () => {
	const SHARES = [0, 0.3, 0.6, 0.999]

	function picks_at(pool: string, tick: number): Array<string> {
		return SHARES.map((share) => cycled(pool, tick, share))
	}

	it.each(POOLS)('picks from %s', (pool) => {
		const picks = [0, 1, 2, 3].flatMap((tick) => picks_at(pool, tick))

		expect(picks.every((ch) => ch !== '' && pool.includes(ch))).toBe(true)
	})

	it.each(POOLS)('never repeats a tick’s pick of %s', (pool) => {
		const repeats = [0, 1, 2, 3].flatMap((tick) => {
			const next = picks_at(pool, tick + 1)

			return picks_at(pool, tick).filter((ch) => next.includes(ch))
		})

		expect(repeats).toStrictEqual([])
	})
})
