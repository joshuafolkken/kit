import { describe, expect, it } from 'vitest'
import { run_board_demo_lanes } from './run-board-demo-lanes'
import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8917: demo mode's three sample lanes, drawn where a board has no lane of its own.

const { is_sample, lines_of, with_samples } = run_board_demo_lanes
const SAMPLE_ISSUES = ['8899', '8897', '8826']
const NARROW = 60

function sample_key(issue: string): string {
	return run_board_row_key.key_of('lanes', issue)
}

describe('run_board_demo_lanes.lines_of', () => {
	it('draws the three sample rows in order, each a running lane the plan keeps', () => {
		const lines = lines_of(false, undefined)

		expect(lines).toHaveLength(SAMPLE_ISSUES.length)
		expect(lines.every(({ text }, index) => text.includes(` ${SAMPLE_ISSUES[index]} `))).toBe(true)
		expect(lines.every(({ row }) => row?.stage === 'running')).toBe(true)
	})

	it('keys each row as a lane row where the board keys its rows', () => {
		const keyed = lines_of(true, undefined)
		const plain = lines_of(false, undefined)

		for (const [index, issue] of SAMPLE_ISSUES.entries()) {
			const text = plain[index]?.text ?? ''

			expect(keyed[index]?.text).toBe(run_board_row_key.keyed('lanes', issue, text))
		}
	})

	it('cuts each row to the pane, a wide pane keeping it whole', () => {
		const cut = lines_of(false, NARROW)
		const whole = lines_of(false, undefined)

		expect(cut.every(({ text }) => run_board_fit.width_of(text) <= NARROW)).toBe(true)
		expect(lines_of(false, 1000)).toStrictEqual(whole)
	})
})

describe('run_board_demo_lanes keys', () => {
	it('counts the sample rows as known keys, the board’s own kept', () => {
		const keys = with_samples(new Set(['lanes:1']))

		expect([...keys]).toStrictEqual(['lanes:1', ...SAMPLE_ISSUES.map((issue) => sample_key(issue))])
	})

	it('tells a sample row’s key from a real lane’s', () => {
		expect(SAMPLE_ISSUES.every((issue) => is_sample(sample_key(issue)))).toBe(true)
		expect(is_sample(sample_key('1'))).toBe(false)
	})
})
