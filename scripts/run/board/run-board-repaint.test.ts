import { describe, expect, it } from 'vitest'
import { run_board_repaint } from './run-board-repaint'

const { current_of, repaint_of, request } = run_board_repaint

describe('run_board_repaint.current_of', () => {
	it('stays current while no redraw is asked', () => {
		expect(current_of(repaint_of())?.()).toBe(true)
	})

	it('is no longer current once a redraw is asked', () => {
		const repaint = repaint_of()
		const is_current = current_of(repaint)

		request(repaint)

		expect(is_current?.()).toBe(false)
	})

	it('checks nothing without a repaint', () => {
		expect(current_of(undefined)).toBeUndefined()
	})
})

describe('run_board_repaint.request', () => {
	it('asks nothing without a repaint', () => {
		expect(() => {
			request(undefined)
		}).not.toThrow()
	})
})
