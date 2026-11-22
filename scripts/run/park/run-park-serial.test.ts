import { describe, expect, it } from 'vitest'
import { run_park_serial } from './run-park-serial'

const SERIAL = 'a serial carve-off, slower than one Issue'
const ORDER_LINE = '- 順序の理由: <kind> — <理由>'

// joshuafolkken/kit#8661: a filing option the parked Issue waits on names its order kind, or the adopt
// refuses it — the kinds are `epic_chain_kind`'s.
describe('run_park_serial.problem_of', () => {
	it('refuses a filing option naming no order kind, pointing at --single', () => {
		const problem = run_park_serial.problem_of({ number: 1 }, true)

		expect(problem).toContain(`option 1 files an Issue the parked one then waits on — ${SERIAL}`)
		expect(problem).toContain('`lane:plan <N> --single "<why>"`')
		expect(problem).toContain(ORDER_LINE)
	})

	it.each([
		['a kind of its own', '分けられない — 同じ時刻を読む'],
		['a kind with no reason', '1 パスで検証できない'],
	])('refuses a filing option whose order reason is %s', (_case, order_reason) => {
		expect(run_park_serial.problem_of({ number: 1, order_reason }, true)).toContain(SERIAL)
	})

	it.each([
		['cannot be verified in one pass', '1 パスで検証できない — 先行の型が要る'],
		['waits on something else', '別の待ちがある — 依存パッケージの修正待ち'],
	])('passes a filing option whose order reason says it %s', (_case, order_reason) => {
		expect(run_park_serial.problem_of({ number: 1, order_reason }, true)).toBeUndefined()
	})

	it('passes an option that files nothing', () => {
		expect(run_park_serial.problem_of({ number: 2 }, false)).toBeUndefined()
	})
})

describe('run_park_serial.reason_of', () => {
	it.each([
		['- 順序の理由: 別の待ちがある — x', '別の待ちがある — x'],
		['- 必要な権限: 親', undefined],
	])('reads %j as %j', (line, expected) => {
		expect(run_park_serial.reason_of(line)).toBe(expected)
	})

	it('prints the order-reason line in the schema', () => {
		expect(run_park_serial.schema_line()).toContain(ORDER_LINE)
	})
})
