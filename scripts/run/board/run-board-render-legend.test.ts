import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_legend, type LegendDrawn } from './run-board-render-legend'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3480: the states the rows draw, in English.
// joshuafolkken/kit#3544: the legend is drawn apart from the rows, which tell it the icons they draw.
// joshuafolkken/kit#4047: only what the frame draws. joshuafolkken/kit#4173: on one line, and never an
// icon the frame draws beside its own word.

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
	const whole = { leads, icons: leads, named: [], checks: [], held: [], solo: false, ...drawn }

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

		expect(legend_of([row(1)], { icons })).toStrictEqual(['🔨 implement  🚢 ship  ⚓ followup'])
	})

	it('names no phase where the frame draws none', () => {
		expect(legend_of([row(1, { state: 'parked' })])).toStrictEqual(['💤 parked'])
	})

	it('names 🔄 only while a row leads with it, not for a row led by its phase', () => {
		const launched = row(1, { state: 'running' })
		const led = new Set(['👀'])

		expect(legend_of([launched], { leads: led, icons: led })).toStrictEqual(['👀 review'])
		expect(legend_of([launched])).toStrictEqual(['🔄 running'])
	})
})

const EVERY_STATE: Array<ItemState> = [
	'withdrawn',
	'merged',
	'waiting',
	'parked',
	'human',
	'paused',
	'stopped',
	'done',
]

describe('run_board_render_legend.legend_of order', () => {
	it('names in progress, then what has settled, then the kinds and the rest, on one line', () => {
		const rows = [...rows_in(EVERY_STATE), row(9, { kind: 'bug' })]
		const leads = new Set([...rows.map((entry) => STATE_ICONS[entry.state]), '🔨'])

		expect(legend_of(rows, { leads, icons: leads, named: [OPERATION] })).toStrictEqual([
			`🔨 implement  ${OPERATION}  💤 parked  🧊 paused  🛑 stopped  🏁 done  🚫 withdrawn  🐛 fix`,
		])
	})

	// joshuafolkken/kit#3577: by their release category, in the release notes' order.
	it('names the kinds the rows draw, in the release notes’ order', () => {
		const kinds = [row(1, { kind: 'bug' }), row(2, { kind: 'breaking-change' }), row(3)]
		const every = [...kinds, row(4, { kind: 'enhancement' })]

		expect(legend_of(kinds)).toStrictEqual(['🧨 breaking  🐛 fix'])
		expect(legend_of(every)).toStrictEqual(['🧨 breaking  ✨ feature  🐛 fix'])
	})

	it('names 🔗 and the checks after the kinds', () => {
		const rows = [row(1, { kind: 'enhancement', waits: ['2'] })]

		expect(legend_of(rows, { checks: [CODERABBIT] })).toStrictEqual([
			`✨ feature  🔗 waits on  ${CODERABBIT}`,
		])
		expect(legend_of([row(1)]).join('\n')).not.toContain('🔗')
	})

	// joshuafolkken/kit#4052: a held check and its reasons, after 🔗 and before the checks.
	it('names the held check and its reasons after 🔗, only where the frame draws them', () => {
		const rows = [row(1, { waits: ['2'] })]
		const held = ['🚧 held check', '💪 cores']

		expect(legend_of(rows, { held, checks: [CODERABBIT] })).toStrictEqual([
			`🔗 waits on  🚧 held check  💪 cores  ${CODERABBIT}`,
		])
		expect(legend_of(rows).join('\n')).not.toContain('🚧')
	})

	it('draws nothing on a screen with no rows, and none of the header’s marks', () => {
		expect(legend_of([])).toStrictEqual([])
	})
})

// joshuafolkken/kit#4288: what each waiting row leads with, named once, in one fixed order.
describe('run_board_render_legend.legend_of wait icons', () => {
	it('names the icons the waiting rows lead with, and none they do not', () => {
		const rows = [row(1, { reason: { icon: '❓' } }), row(2, { reason: { icon: '🧵' } })]
		const again = [...rows, row(3, { reason: { icon: '🧵', value: '3/3' } })]
		const named = ['🧵 free lane  ❓ untriaged']

		expect(legend_of(rows)).toStrictEqual(named)
		expect(legend_of(again)).toStrictEqual(named)
		expect(legend_of([row(1, { reason: { tail: 'fullrun #1' } })])).toStrictEqual([])
	})

	it('names 🔗 for blockers after a title, not for a waiting row its own icon leads', () => {
		const untriaged = row(1, { waits: ['3'], reason: { icon: '❓', issues: ['3'] } })
		const asked = row(2, { state: 'human', waits: ['3'] })

		expect(legend_of([untriaged])).toStrictEqual(['❓ untriaged'])
		expect(legend_of([asked])).toStrictEqual(['🔗 waits on'])
	})

	it.each([
		['🚪', 'opening lane'],
		['📥', 'installing'],
		['📤', 'dispatching'],
		['📂', 'path held'],
		['📋', 'named order'],
		['✋', 'held by triage'],
		['🧠', 'memory headroom'],
		['📅', 'not before'],
	])('names %s as "%s"', (icon, word) => {
		expect(legend_of([row(1, { reason: { icon } })])).toStrictEqual([`${icon} ${word}`])
	})
})

// joshuafolkken/kit#4173: ⏳ under `⏳ queued`, 🙋 under `🙋 decision` and ✅ under `✅ done` carry
// their own word. joshuafolkken/kit#4288: 📅 no longer does, so the wait icons name it.
describe('run_board_render_legend.legend_of icons drawn with their own word', () => {
	it('names none of ⏳, 🙋 and ✅, and draws nothing where they are all the frame draws', () => {
		const rows = rows_in(['waiting', 'human', 'merged'])
		const leads = new Set(rows.map((entry) => STATE_ICONS[entry.state]))

		expect(legend_of(rows, { leads, icons: leads })).toStrictEqual([])
	})
})

describe('run_board_render_legend.legend_of with the third line’s kind', () => {
	it('names the kind after the phases where the line’s own words do not name it', () => {
		expect(legend_of([row(1)], { named: [OPERATION] })).toStrictEqual([OPERATION])
	})

	// joshuafolkken/kit#3769: the header and a row's tail can both draw 🔧, named once.
	it('names a kind the header and a row both draw once', () => {
		expect(legend_of([row(1)], { named: [OPERATION, OPERATION] })).toStrictEqual([OPERATION])
	})
})

// joshuafolkken/kit#4294: 🧍 and 🙅 are named only while a row leads with them.
describe('run_board_render_legend.legend_of run:solo icons', () => {
	const { WAIT_ICONS } = run_board_labels

	it('names 🧍 and 🙅 where a row leads with each', () => {
		const solo = row(1, { reason: { icon: WAIT_ICONS.solo, issues: ['3'] } })
		const behind = row(2, { reason: { icon: WAIT_ICONS.solo_ahead, issues: ['1'] } })

		expect(legend_of([solo, behind])).toStrictEqual(['🧍 runs alone  🙅 behind solo'])
	})

	// joshuafolkken/kit#4391: 🔒, a row a running run:solo issue holds.
	it('names 🔒 only where a row leads with it', () => {
		const held = row(1, { reason: { icon: WAIT_ICONS.solo_running, issues: ['4374'] } })

		expect(legend_of([held])).toStrictEqual(['🔒 solo running'])
		expect(legend_of([row(1)]).join('\n')).not.toContain(WAIT_ICONS.solo_running)
	})

	// joshuafolkken/kit#4625: 🧍 in a solo lane row's indent.
	it('names 🧍 once where a solo lane row draws it, beside a waiting row leading with it or not', () => {
		const waiting = row(2, { reason: { icon: WAIT_ICONS.solo, issues: ['1'] } })

		const named = ['🧍 runs alone']

		expect(legend_of([row(1)], { solo: true })).toStrictEqual(named)
		expect(legend_of([row(1), waiting], { solo: true })).toStrictEqual(named)
	})

	it('names neither where no row leads with them', () => {
		expect(legend_of([row(1, { reason: { icon: WAIT_ICONS.lane } })])).toStrictEqual([
			'🧵 free lane',
		])
	})
})

// joshuafolkken/kit#4772: 🔍 at a done row's end, where no spinner turns for its overrun investigation.
describe('run_board_render_legend.legend_of overrun investigation', () => {
	it('names 🔍 while a done row draws it', () => {
		expect(legend_of([row(1)], { overrun: true })).toStrictEqual(['🔍 overrun investigation'])
	})

	it('names nothing where no row draws it', () => {
		expect(legend_of([row(1)])).toStrictEqual([])
	})
})
