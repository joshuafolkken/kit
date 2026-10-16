import { lane_await } from '#scripts/lane/lane-await'
import { describe, expect, it } from 'vitest'
import { run_board_idle } from './run-board-idle'

// joshuafolkken/kit#3893: one bare probe drew a lane stopped while its child was between a boundary cut
// and its resume, so a lane is drawn stopped only once it has stayed idle for `lane:await`'s window.

const { NO_IDLE, since_of, stopped_of } = run_board_idle
const AT = Date.parse('2026-10-08T09:00:00.000Z')
const WINDOW = lane_await.RECONFIRM_MS

describe('run_board_idle.since_of', () => {
	it('keeps when a lane was first read idle and drops one read working again', () => {
		const first = since_of(NO_IDLE, ['1', '2'], AT)

		expect(since_of(first, ['1', '3'], AT + WINDOW)).toStrictEqual(
			new Map([
				['1', AT],
				['3', AT + WINDOW],
			]),
		)
	})
})

describe('run_board_idle.stopped_of', () => {
	it('names only the lanes idle for the whole window', () => {
		const since = since_of(since_of(NO_IDLE, ['1'], AT), ['1', '2'], AT + 1)

		expect(stopped_of(since, AT + WINDOW)).toStrictEqual(['1'])
	})

	it('names none before any read', () => {
		expect(stopped_of(since_of(NO_IDLE, ['1'], AT), undefined)).toStrictEqual([])
	})
})
