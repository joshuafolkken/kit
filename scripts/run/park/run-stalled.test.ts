import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_stalled } from './run-stalled'

const CHILD = '4188'
const CAUSE = 'review failed'

describe('run_stalled.park_event', () => {
	it('carries the cause after the label', () => {
		expect(run_stalled.park_event(CHILD, CAUSE)).toBe(
			`#4188 parked (${RUN_STALLED_LABEL}: review failed)`,
		)
	})
})

describe('run_stalled.cause_of', () => {
	it('reads the cause a park reason carries', () => {
		expect(run_stalled.cause_of(`${RUN_STALLED_LABEL}: ${CAUSE}`)).toBe(CAUSE)
	})

	it('reads a bare run:stalled reason, written before it carried one, as no cause', () => {
		expect(run_stalled.cause_of(RUN_STALLED_LABEL)).toBe('')
	})

	it('answers undefined for a reason that is no run:stalled park', () => {
		expect(run_stalled.cause_of('needs-decision')).toBeUndefined()
		expect(run_stalled.cause_of('ship-stop cap')).toBeUndefined()
	})
})

describe('run_stalled.row_text', () => {
	it('selects the live retry command from the shared resume source (ac-e988f4c9)', () => {
		expect(run_stalled.row_text(CHILD, CAUSE, true)).toBe(
			'→ resume: pnpm josh run:add 4188 --retry (review failed)',
		)
		expect(run_stalled.next_step(CHILD)).toContain(`\`${run_stalled.resume_of(CHILD, true)}\``)
	})

	it('draws the resume action followed by its cause in parentheses', () => {
		expect(run_stalled.row_text(CHILD, CAUSE)).toBe('→ resume: fullrun #4188 (review failed)')
	})

	it('draws the action alone where no cause was recorded', () => {
		expect(run_stalled.row_text(CHILD)).toBe('→ resume: fullrun #4188')
	})
})

describe('run_stalled.next_step', () => {
	it('repairs the dedicated stale hand-off cause before retry (ac-ee2a4e59)', () => {
		const step = run_stalled.next_step(CHILD, run_stalled.STALE_HANDOFF.why)

		expect(step).toContain('repair the stale hand-off cut record with `pnpm josh run:cut --end`')
		expect(step).toContain('(retry alone does not clear it), then use')
	})

	it('preserves ordinary cause recovery (ac-f1c11e14)', () => {
		expect(run_stalled.next_step(CHILD, CAUSE)).toBe(
			'fix the cause, then use `pnpm josh run:add 4188 --retry` in the live backlogrun or resume it with `fullrun #4188`',
		)
	})

	it('names the standalone resume and the live backlog retry command', () => {
		const step = run_stalled.next_step(CHILD)

		expect(step).toContain(`\`${run_stalled.resume_of(CHILD)}\``)
		expect(step).toContain('pnpm josh run:add 4188 --retry')
	})
})
