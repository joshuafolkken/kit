import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_legend } from './run-board-render-legend'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3480: every phase on its lines, the states the rows draw on one more, in English.
// joshuafolkken/kit#3544: the legend is drawn apart from the rows, which tell it the icons they lead with.

const { STATE_ICONS } = run_board_labels

// joshuafolkken/kit#3526: the track's twelve marks in its order, six to a line.
const PHASE_LEGEND = [
	'🔍 investigate  📝 plan  🔨 implement  🚢 ship  👀 review  🚦 gate',
	'🔀 sync  📦 commit  🔂 round-2  ⚓ followup  📣 report  💥 failed',
]

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

// The legend for `rows`, each leading with its state's icon unless `drawn` names what they lead with.
function legend_of(
	rows: ReadonlyArray<BoardRow>,
	drawn: ReadonlyArray<string> = rows.map((entry) => STATE_ICONS[entry.state]),
): Array<string> {
	return run_board_render_legend
		.legend_of(rows, new Set(drawn), [])
		.map((line) => stripVTControlCharacters(line))
}

function rows_in(states: ReadonlyArray<ItemState>): Array<BoardRow> {
	return states.map((state, index) => row(index + 1, { state }))
}

describe('run_board_render_legend.legend_of', () => {
	it('names every phase in order on its lines, though no row draws a phase', () => {
		expect(legend_of([row(1)])).toStrictEqual([...PHASE_LEGEND, '⏳ waiting'])
	})

	it('names only the states the rows draw, in the legend’s order', () => {
		const mixed = rows_in(['human', 'stopped', 'done', 'parked', 'merged'])

		expect(legend_of(rows_in(['parked', 'merged'])).at(-1)).toBe('✅ merged  💤 parked')
		expect(legend_of(mixed).at(-1)).toBe('✅ merged  💤 parked  🏁 done  🛑 stopped  🙋 decision')
	})

	it('names 🔄 only while a row draws it, not for a row led by its phase', () => {
		const launched = row(1, { state: 'running' })

		expect(legend_of([launched], ['👀'])).toStrictEqual(PHASE_LEGEND)
		expect(legend_of([launched]).at(-1)).toBe('🔄 running')
	})

	it('names 🔗 only while a row draws a wait', () => {
		expect(legend_of([row(1), row(2, { waits: ['1'] })]).at(-1)).toBe('⏳ waiting  🔗 waits on')
		expect(legend_of([row(1)]).at(-1)).not.toContain('🔗')
	})

	it('draws the phase line alone on a screen with no rows, and none of the header’s marks', () => {
		const legend = legend_of([])

		expect(legend).toStrictEqual(PHASE_LEGEND)

		for (const icon of ['⚡', '🧠', '💾', '🔚']) {
			expect(legend.join('\n')).not.toContain(icon)
		}
	})
})
