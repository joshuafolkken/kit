import { describe, expect, it } from 'vitest'
import { run_event_checks, type PrChecks } from './run-event-checks'

// joshuafolkken/kit#3770: `josh followup` writes the `pr-checks` line and `run:board` reads it back
// through one format, so the checks written are the checks drawn.

const CHECKS: PrChecks = { pr: 3765, pass: 6, pending: 2, fail: 0, coderabbit: 'rate-limited' }
const TEXT = '#3754 PR 3765 pass 6 pending 2 fail 0 coderabbit rate-limited'

describe('run_event_checks', () => {
	it('writes the issue first, then the pull request, the counts and CodeRabbit’s state', () => {
		expect(run_event_checks.text_of('3754', CHECKS)).toBe(TEXT)
	})

	it('reads back what it writes', () => {
		expect(run_event_checks.checks_of(TEXT)).toStrictEqual(CHECKS)
	})

	it('reads no checks from a line of another shape or an unknown CodeRabbit state', () => {
		expect(run_event_checks.checks_of('#3754 followup start')).toBeUndefined()
		expect(
			run_event_checks.checks_of('#3754 PR 3765 pass 6 pending 2 fail 0 coderabbit asleep'),
		).toBeUndefined()
	})
})
