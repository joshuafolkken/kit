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

// joshuafolkken/kit#7076: the drive's auto-retry reads a park's cause back off its event text.
describe('run_stalled.cause_in', () => {
	it("reads back the cause park_event wrote, park_event's inverse", () => {
		expect(run_stalled.cause_in(run_stalled.park_event(CHILD, CAUSE))).toBe(CAUSE)
	})

	it('answers undefined for a park text with no run:stalled cause', () => {
		expect(run_stalled.cause_in(`#${CHILD} parked`)).toBeUndefined()
		expect(run_stalled.cause_in(`#${CHILD} parked (needs-decision)`)).toBeUndefined()
	})
})

describe('run_stalled.class_of', () => {
	it("reads a session-unfinished cause carrying the child's message as its class", () => {
		const { short } = run_stalled.session_unfinished('Done, PR opened.\nAnother line.')

		expect(short).toBe('session unfinished: Done, PR opened.')
		expect(run_stalled.class_of(short)).toBe(run_stalled.SESSION_UNFINISHED.short)
	})

	it('keeps any other cause as it is', () => {
		expect(run_stalled.class_of(CAUSE)).toBe(CAUSE)
		expect(run_stalled.class_of(run_stalled.SESSION_UNFINISHED.short)).toBe('session unfinished')
	})
})

// joshuafolkken/kit#6864: a park records the ship stop it was taken at, and an older park reads as none.
describe('run_stalled.stop_of', () => {
	const PARK = { pos: 1, at: '2026-11-09T00:00:00.000Z', kind: 'park', text: '#4188 parked' }

	it('reads the stage and cause class a park recorded', () => {
		const stop = { stage: 'followup', cause: 'check' }

		expect(run_stalled.stop_of({ ...PARK, stop })).toStrictEqual(stop)
	})

	it('reads a park written before it carried a stop as none', () => {
		expect(run_stalled.stop_of(PARK)).toBeUndefined()
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
