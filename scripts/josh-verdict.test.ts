import { describe, expect, it } from 'vitest'
import { josh_verdict } from './josh-verdict'

// The round trip is the point of the module (joshuafolkken/kit#1374): the line `josh gate` prints and
// the line `josh time` matches are built from one prefix, so a reworded verdict cannot leave the
// detector matching a string nothing prints any more.

const STEP_COUNT = '4'
const TOTAL = '15.1s'
const FAILED_LABELS = 'lint, cspell'

describe('the verdict line a josh command prints about itself', () => {
	it('reads back the passed line it formats', () => {
		const line = josh_verdict.format_gate_passed(STEP_COUNT, TOTAL)

		expect(josh_verdict.read_verdict(line)).toBe(josh_verdict.PASSED_VERDICT)
	})

	it('reads back the failed line it formats', () => {
		const line = josh_verdict.format_gate_failed(FAILED_LABELS, TOTAL)

		expect(josh_verdict.read_verdict(line)).toBe(josh_verdict.FAILED_VERDICT)
	})

	it('keeps the wording the documented output shows', () => {
		expect(josh_verdict.format_gate_passed(STEP_COUNT, TOTAL)).toBe(
			'✔ verification gate passed (4 checks) in 15.1s.',
		)
		expect(josh_verdict.format_gate_failed(FAILED_LABELS, TOTAL)).toBe(
			'✗ verification gate failed: lint, cspell (15.1s)',
		)
	})

	it('reads a verdict a caller quoted into an indented block', () => {
		const line = `    ${josh_verdict.format_gate_failed(FAILED_LABELS, TOTAL)}`

		expect(josh_verdict.read_verdict(line)).toBe(josh_verdict.FAILED_VERDICT)
	})

	// A step line opens with the same icon and is not a verdict: only the gate's own summary settles
	// the call, which is what keeps a forwarded body from doing so.
	it('is silent about a line that is not a verdict', () => {
		expect(josh_verdict.read_verdict('✗ lint (pnpm josh lint) 4.2s')).toBeUndefined()
		expect(josh_verdict.read_verdict('  ✗ eslint')).toBeUndefined()
		expect(josh_verdict.read_verdict('')).toBeUndefined()
	})
})
