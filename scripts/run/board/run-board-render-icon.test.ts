import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_icon } from './run-board-render-icon'
import type { ItemState, ItemStatus } from './run-board-status'

// joshuafolkken/kit#4099: the icon a row leads with — a running row's phase, a not-before wait's 📅,
// otherwise its state's. A held lane keeps its phase's icon, 🚧 standing before it (#4292).

const { state_icon } = run_board_render_icon
const LANE = 7

function row(state: ItemState, status?: ItemStatus, reason?: BoardRow['reason']): BoardRow {
	return { number: LANE, title: 'Issue', kind: undefined, state, status, waits: [], reason }
}

describe('run_board_render_icon.state_icon', () => {
	it.each([
		['running', '🔄'],
		['merged', '✅'],
		['parked', '💤'],
		['human', '🙋'],
		['waiting', '⏳'],
	] as const)('leads a %s row with no track with %s', (state, icon) => {
		expect(state_icon(row(state))).toBe(icon)
	})

	it('leads a running row with its last phase, and a settled one with its state', () => {
		const track = ['implement', 'review'] as const

		expect(state_icon(row('running', { state: 'running', track }))).toBe('👀')
		expect(state_icon(row('merged', { state: 'merged', track }))).toBe('✅')
	})

	// joshuafolkken/kit#4288: every wait leads with its own icon in place of ⏳.
	it.each(['📅', '🧵', '📂', '❓'])('leads a row whose wait leads with %s with it', (icon) => {
		expect(state_icon(row('waiting', undefined, { icon }))).toBe(icon)
	})

	it('leads a waiting row whose wait names no icon with ⏳', () => {
		expect(state_icon(row('waiting', undefined, { tail: 'fullrun #3' }))).toBe('⏳')
	})
})
