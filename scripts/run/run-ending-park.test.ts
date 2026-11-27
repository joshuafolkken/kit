import { describe, expect, it } from 'vitest'
import { run_park_body } from './park/run-park-body'
import { run_ending_park, type AbandonedPark } from './run-ending-park'

const BASIS =
	'exit record: subtype=success, is_error=false, num_turns=53, permission_denials=3; the Issue is OPEN and no cut was recorded (uncommitted work remains).'

function park(overrides: Partial<AbandonedPark> = {}): AbandonedPark {
	return { basis: BASIS, has_ask: false, issue: '9064', ...overrides }
}

describe('the abandoned park body', () => {
	it('passes the run:park body check', () => {
		const body = run_ending_park.abandoned_body(park())

		expect(run_park_body.problem_of(body)).toBeUndefined()
	})

	it('carries the exit-record basis under its reason and a next step', () => {
		const body = run_ending_park.abandoned_body(park())

		expect(body).toContain('### 理由')
		expect(body).toContain('### 次の一手')
		expect(body).toContain('permission_denials=3')
		expect(body).toContain('uncommitted work remains')
	})

	it('recommends re-dispatching the same lane as the parent', () => {
		const body = run_ending_park.abandoned_body(park())

		expect(run_park_body.summary_of(body)).toBe('推奨: 1（層 A · 親の操作）')
		expect(body).toContain('pnpm josh run:add 9064 --retry')
	})

	it('recommends nothing when the child left a refused ask', () => {
		const body = run_ending_park.abandoned_body(park({ has_ask: true }))

		expect(run_park_body.problem_of(body)).toBeUndefined()
		expect(run_park_body.summary_of(body)).toBe('推奨なし')
	})
})
