import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'

// joshuafolkken/kit#8154: an icon beside its label is marked so the WarGames theme can drop it, while
// every other frame is drawn as it was.

const { MARK, TITLE_MARK, bare, dropped, pair, settled, titled, untitled } = run_board_label_pair
const VALUES = '  💪 67%  ✅ 264/283'

function column_of(line: string, text: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(text)))
}

describe('run_board_label_pair.pair', () => {
	it('draws `icon word` with the icon between two marks that take no columns', () => {
		const label = pair('💪', 'CPU')

		expect(label).toBe(`${MARK}💪${MARK} CPU`)
		expect(bare(label)).toBe('💪 CPU')
		expect(run_board_fit.width_of(label)).toBe(run_board_fit.width_of('💪 CPU'))
	})
})

describe('run_board_label_pair.settled', () => {
	const lines = [`── ${pair('⏳', 'queued')} ──`]

	it('keeps the marks for a themed screen alone', () => {
		expect(settled(lines, { form: 'screen', is_themed: true })).toStrictEqual(lines)
	})

	it.each([
		{ form: 'screen', is_themed: false },
		{ form: 'screen', is_themed: undefined },
		{ form: 'chat', is_themed: true },
	] as const)('draws $form (themed: $is_themed) bare', (drawn) => {
		expect(settled(lines, drawn)).toStrictEqual(['── ⏳ queued ──'])
	})
})

describe('run_board_label_pair.dropped', () => {
	it('draws a dropped icon in a rule as the rule, the label and its columns kept', () => {
		const line = `── 📈 throughput ──── ${pair('⚡', '/h')} ──── 🏔 PEAK ──`
		const drawn = dropped(line)

		expect(drawn).toBe('── 📈 throughput ─────── /h ──── 🏔 PEAK ──')
		expect(run_board_fit.width_of(drawn)).toBe(run_board_fit.width_of(bare(line)))
		expect(column_of(drawn, '🏔')).toBe(column_of(bare(line), '🏔'))
	})

	it.each([
		{ lead: '▾ ', drawn: '▾ ── queued 6 ──' },
		{ lead: '── ', drawn: '── ── queued 6 ──' },
	])(
		'draws a dropped icon after a heading lead `$lead` as the rule, the gap kept',
		({ lead, drawn }) => {
			expect(dropped(`${lead}${pair('⏳', 'queued')} 6 ──`)).toBe(drawn)
		},
	)

	it('moves a row label into its icon columns, its cells kept where they were', () => {
		const line = `  ${pair('▶', 'backlogrun')}      46.6`
		const drawn = dropped(line)

		expect(drawn).toBe('  backlogrun        46.6')
		expect(drawn.indexOf('46.6')).toBe(bare(line).indexOf('46.6'))
	})

	it('leaves an unmarked icon before a value as it is', () => {
		expect(dropped(VALUES)).toBe(VALUES)
	})
})

// joshuafolkken/kit#8224: a row's title is marked for the WarGames reveal, in no columns.
describe('run_board_label_pair title marks', () => {
	const titled_line = `  ${pair('▶', 'backlogrun')}      ${titled('A TITLE')}  46.6`

	it('keeps the title mark for a themed screen alone', () => {
		expect(settled([titled_line], { form: 'screen', is_themed: true })).toStrictEqual([titled_line])
	})

	it.each([
		{ form: 'screen', is_themed: false },
		{ form: 'chat', is_themed: true },
	] as const)('drops the title mark for $form (themed: $is_themed)', (drawn) => {
		expect(settled([titled_line], drawn)).toStrictEqual(['  ▶ backlogrun      A TITLE  46.6'])
	})

	it('draws a titled title in the columns of the title alone', () => {
		expect(titled('A TITLE')).toBe(`${TITLE_MARK}A TITLE`)
		expect(run_board_fit.width_of(titled('A TITLE'))).toBe(run_board_fit.width_of('A TITLE'))
	})

	it('moves a row label past a title mark as it does without one', () => {
		expect(untitled(dropped(titled_line))).toBe(dropped(untitled(titled_line)))
	})
})
