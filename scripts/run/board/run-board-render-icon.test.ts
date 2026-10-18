import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_icon } from './run-board-render-icon'
import type { ItemState, ItemStatus } from './run-board-status'

// joshuafolkken/kit#4099: the icon a row leads with — a running row's phase, a held lane's 🚧, a
// not-before wait's 📅, otherwise its state's.

const { header } = run_board_render_fixture
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
		expect(state_icon(row(state), header())).toBe(icon)
	})

	it('leads a running row with its last phase, and a settled one with its state', () => {
		const track = ['implement', 'review'] as const

		expect(state_icon(row('running', { state: 'running', track }), header())).toBe('👀')
		expect(state_icon(row('merged', { state: 'merged', track }), header())).toBe('✅')
	})

	it('leads a row waiting on its start time with 📅', () => {
		const reason = { text: 'not before', is_not_before: true }

		expect(state_icon(row('waiting', undefined, reason), header())).toBe('📅')
	})

	it('leads a running lane held for the budget with 🚧 over its phase', () => {
		const wait = {
			lane: String(LANE),
			elsewhere: undefined,
			command: undefined,
			waited_ms: 1,
			reason: 'cores' as const,
		}
		const running = row('running', { state: 'running', track: ['gate'] })

		expect(state_icon(running, header({ budget_waits: [wait] }))).toBe('🚧')
	})
})
