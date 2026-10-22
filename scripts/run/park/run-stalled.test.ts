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
	it('draws the cause, then the action that resumes the issue', () => {
		expect(run_stalled.row_text(CHILD, CAUSE)).toBe('review failed → fullrun #4188')
	})

	it('draws the action alone where no cause was recorded', () => {
		expect(run_stalled.row_text(CHILD)).toBe('fullrun #4188')
	})
})

describe('run_stalled.next_step', () => {
	it('names the resume command and the label to remove', () => {
		const step = run_stalled.next_step(CHILD)

		expect(step).toContain(`\`${run_stalled.resume_of(CHILD)}\``)
		expect(step).toContain(`remove \`${RUN_STALLED_LABEL}\``)
	})
})
