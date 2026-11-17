import { describe, expect, it } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_request } from './run-hold-request'

const ISSUE = '7724'

// joshuafolkken/kit#7724: the claim carries the run's mark, so `run:board` can name a `prrun` apart.
describe('run_hold_request.parse_request — the claim mark', () => {
	it.each([
		[[ISSUE, '--fullrun'], { kind: 'claim', issue: ISSUE, mark: run_hold.FULLRUN_MARK }],
		[[ISSUE, '--prrun'], { kind: 'claim', issue: ISSUE, mark: run_hold.PRRUN_MARK }],
		[[ISSUE], { kind: 'claim', issue: ISSUE }],
		[[], { kind: 'claim', issue: run_hold.UNNUMBERED_ISSUE }],
	])('reads %j as %o', (argv, request) => {
		expect(run_hold_request.parse_request(argv)).toStrictEqual(request)
	})

	it('refuses a mark flag with no issue', () => {
		expect(run_hold_request.parse_request(['--prrun'])).toBeUndefined()
	})
})

describe('run_hold_request — the request guards', () => {
	it.each([
		[[ISSUE, '--prrun-stop'], true, false],
		[[ISSUE, '--halfrun-round'], false, true],
		[['--adopt', ISSUE], false, true],
		[[ISSUE, '--prrun'], false, false],
	])('reads %j as a stop %s, a take-over %s', (argv, is_stop, is_take_over) => {
		const request = run_hold_request.parse_request(argv)

		if (request === undefined) throw new Error('unparsed request')

		expect([
			run_hold_request.is_stop_request(request),
			run_hold_request.is_take_over_request(request),
		]).toStrictEqual([is_stop, is_take_over])
	})
})
