import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_legend, type LegendDrawn } from './run-board-render-legend'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3480: the states the rows draw, in English.
// joshuafolkken/kit#3544: the legend is drawn apart from the rows, which tell it the icons they draw.
// joshuafolkken/kit#4047: only what the frame draws — in progress, waiting and done on one line, the
// kinds and the rest on the next.

const { STATE_ICONS } = run_board_labels
// joshuafolkken/kit#3767: the third line's kind is named among what is in progress.
const OPERATION = '🔧 operation'
const CODERABBIT = '🐰 CodeRabbit'

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'waiting',
		status: undefined,
		kind: undefined,
		waits: [],
		...extra,
	}
}

// The legend for `rows`, each leading with its state's icon unless `drawn` names what the frame draws.
function legend_of(rows: ReadonlyArray<BoardRow>, drawn: Partial<LegendDrawn> = {}): Array<string> {
	const leads = new Set(rows.map((entry) => STATE_ICONS[entry.state]))
	const whole = { leads, icons: leads, named: [], checks: [], held: [], ...drawn }

	return run_board_render_legend
		.legend_of(rows, whole, [])
		.map((line) => stripVTControlCharacters(line))
}

function rows_in(states: ReadonlyArray<ItemState>): Array<BoardRow> {
	return states.map((state, index) => row(index + 1, { state }))
}

describe('run_board_render_legend.legend_of phases', () => {
	it('names only the phases the frame draws, in the order a run passes them', () => {
		const icons = new Set(['🚢', '🔨', '⚓'])

		expect(legend_of([row(1)], { icons })).toStrictEqual([
			'🔨 implement  🚢 ship  ⚓ followup  ⏳ waiting',
		])
	})

	it('names no phase where the frame draws none', () => {
		expect(legend_of([row(1)])).toStrictEqual(['⏳ waiting'])
	})

	it('names 🔄 only while a row leads with it, not for a row led by its phase', () => {
		const launched = row(1, { state: 'running' })
		const led = new Set(['👀'])

		expect(legend_of([launched], { leads: led, icons: led })).toStrictEqual(['👀 review'])
		expect(legend_of([launched])).toStrictEqual(['🔄 running'])
	})
})

describe('run_board_render_legend.legend_of order', () => {
	it('names in progress, then waiting, then done, on one line', () => {
		const rows = rows_in(['withdrawn', 'merged', 'waiting', 'parked', 'human', 'stopped', 'done'])
		const leads = new Set([...rows.map((entry) => STATE_ICONS[entry.state]), '🔨'])

		expect(legend_of(rows, { leads, icons: leads, named: [OPERATION] })).toStrictEqual([
			`🔨 implement  ${OPERATION}  💤 parked  ⏳ waiting  🛑 stopped  🙋 decision  ✅ merged  🏁 done  🚫 withdrawn`,
		])
	})

	// joshuafolkken/kit#3577: by their release category, in the release notes' order.
	it('names the kinds the rows draw on the next line, in the release notes’ order', () => {
		const kinds = [row(1, { kind: 'bug' }), row(2, { kind: 'breaking-change' }), row(3)]
		const every = [...kinds, row(4, { kind: 'enhancement' })]

		expect(legend_of(kinds)).toStrictEqual(['⏳ waiting', '🧨 breaking  🐛 fix'])
		expect(legend_of(every).at(-1)).toBe('🧨 breaking  ✨ feature  🐛 fix')
	})

	it('names 🔗 and the checks after the kinds', () => {
		const rows = [row(1, { kind: 'enhancement', waits: ['2'] })]

		expect(legend_of(rows, { checks: [CODERABBIT] }).at(-1)).toBe(
			`✨ feature  🔗 waits on  ${CODERABBIT}`,
		)
		expect(legend_of([row(1)]).join('\n')).not.toContain('🔗')
	})

	// joshuafolkken/kit#4052: a held check and its reasons, after 🔗 and before the checks.
	it('names the held check and its reasons after 🔗, only where the frame draws them', () => {
		const rows = [row(1, { waits: ['2'] })]
		const held = ['🚧 held check', '💪 cores']

		expect(legend_of(rows, { held, checks: [CODERABBIT] }).at(-1)).toBe(
			`🔗 waits on  🚧 held check  💪 cores  ${CODERABBIT}`,
		)
		expect(legend_of(rows).join('\n')).not.toContain('🚧')
	})

	it('draws nothing on a screen with no rows, and none of the header’s marks', () => {
		expect(legend_of([])).toStrictEqual([])
	})
})

describe('run_board_render_legend.legend_of with the third line’s kind', () => {
	it('names the kind after the phases where the line’s own words do not name it', () => {
		expect(legend_of([row(1)], { named: [OPERATION] })).toStrictEqual([`${OPERATION}  ⏳ waiting`])
	})

	// joshuafolkken/kit#3769: the header and a row's tail can both draw 🔧, named once.
	it('names a kind the header and a row both draw once', () => {
		expect(legend_of([row(1)], { named: [OPERATION, OPERATION] })).toStrictEqual([
			`${OPERATION}  ⏳ waiting`,
		])
	})
})
