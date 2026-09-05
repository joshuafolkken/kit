import { describe, expect, it } from 'vitest'
import { gate_plan } from './gate-plan'
import { josh_verdict } from './josh-verdict'

// The round trip is the point of the module (joshuafolkken/kit#1374): the line `josh gate` prints and
// the line `josh time` matches are built from one prefix, so a reworded verdict cannot leave the
// detector matching a string nothing prints any more.

const STEP_COUNT = '4'
const TOTAL = '15.1s'
const FAILED_LABELS = 'lint, cspell'
const STEP_HEADER = '✗ lint (pnpm josh lint) 4.2s'
const CONCURRENCY = 4
const CAP = 7
const CORES = 10

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
		expect(josh_verdict.read_verdict(STEP_HEADER)).toBeUndefined()
		expect(josh_verdict.read_verdict('  ✗ eslint')).toBeUndefined()
		expect(josh_verdict.read_verdict('')).toBeUndefined()
	})
})

// The same round trip for the line that says where a gate run's output begins
// (joshuafolkken/kit#1379). It is asserted against what `gate-plan.ts` actually prints, so the two
// ends cannot drift apart without this failing.
describe('the opening line a gate prints before its checks', () => {
	it('reads back the line the gate formats', () => {
		const line = gate_plan.format_gate_plan(
			{ concurrency: CONCURRENCY, unit_worker_cap: CAP },
			CORES,
		)

		expect(line).toBe('plan: 4 of 4 checks at once, test:unit at 7 workers (10 cores)')
		expect(josh_verdict.is_gate_opening(line)).toBe(true)
	})

	it('reads one a caller quoted into an indented block', () => {
		expect(josh_verdict.is_gate_opening('    plan: 2 of 4 checks at once, unit unrestricted')).toBe(
			true,
		)
	})

	// The narrowness is the safety: a forwarded body read as the opening line would start the region
	// above the lines the bound exists to keep readable.
	it('is silent about the verdict, a step header and a line that merely plans something', () => {
		expect(josh_verdict.is_gate_opening(josh_verdict.format_gate_passed(STEP_COUNT, TOTAL))).toBe(
			false,
		)
		expect(josh_verdict.is_gate_opening(STEP_HEADER)).toBe(false)
		expect(josh_verdict.is_gate_opening('plan: apply 3 changes')).toBe(false)
	})
})
