import { run_step } from '#scripts/run/run-step'
import { describe, expect, it } from 'vitest'
import { run_entry, type EntryParts } from './run-entry'

const OK = 0
const FAILED = 1

function parts(overrides: Partial<EntryParts>): EntryParts {
	return {
		issue_number: '2372',
		hold: 'hold',
		cost: 'under',
		verdict: 'implement',
		report: '=== issue ===\n...',
		...overrides,
	}
}

describe('run_entry.stage_verdict — preserve the entry gates on PR resume', () => {
	it('routes only ordinary implementation to the verification gate', () => {
		expect(run_entry.stage_verdict('pr-open', 'implement')).toBe('gate')
		expect(run_entry.stage_verdict('fresh', 'implement')).toBe('implement')
	})

	it.each([
		run_step.UNKNOWN,
		run_step.HUMAN_REVIEW,
		run_step.UPDATE_DEPS,
		run_step.ALREADY_DONE,
		run_step.KEEP_WORK,
	])('preserves %s from the fresh issue read', (verdict) => {
		const resumed = run_entry.stage_verdict('pr-open', verdict)

		expect(resumed).toBe(verdict)
		expect(run_entry.exit_code(parts({ verdict: resumed }))).toBe(
			verdict === run_step.UNKNOWN ? FAILED : OK,
		)
	})
})

describe('run_entry.summary — the first line carries the three facts a run branches on', () => {
	it('names the hold, the budget and the pre-implementation verdict in order', () => {
		expect(run_entry.summary(parts({}))).toBe(
			'entry #2372 — hold: hold · cost: under · verdict: implement',
		)
	})

	it('shows the placeholder verdict on a short-circuit before the step', () => {
		const line = run_entry.summary(parts({ hold: 'busy', verdict: run_entry.NO_VERDICT }))

		expect(line).toBe('entry #2372 — hold: busy · cost: under · verdict: -')
	})
})

describe('run_entry.format_report — the summary sits above the bundled report', () => {
	it('joins the summary and the report body with a blank line', () => {
		expect(run_entry.format_report(parts({ report: 'body' }))).toBe(
			'entry #2372 — hold: hold · cost: under · verdict: implement\n\nbody',
		)
	})
})

describe('run_entry.can_proceed — the two gates a run stops on', () => {
	it('proceeds only on a held tree with a budget not spent', () => {
		expect(run_entry.can_proceed('hold', run_entry.COST_UNDER)).toBe(true)
		expect(run_entry.can_proceed('hold', run_entry.COST_SKIPPED)).toBe(true)
	})

	it('stops on a tree not held or a spent budget', () => {
		expect(run_entry.can_proceed('busy', run_entry.COST_UNDER)).toBe(false)
		expect(run_entry.can_proceed('unknown', run_entry.COST_UNDER)).toBe(false)
		expect(run_entry.can_proceed('hold', run_entry.COST_OVER)).toBe(false)
	})
})

describe('run_entry.exit_code — non-zero is a stop or an unreadable state, a flow verdict is zero', () => {
	it('exits zero on an entry that can proceed whatever flow the verdict names', () => {
		expect(run_entry.exit_code(parts({ verdict: 'implement' }))).toBe(OK)
		expect(run_entry.exit_code(parts({ verdict: 'update-deps' }))).toBe(OK)
		expect(run_entry.exit_code(parts({ verdict: 'human-review' }))).toBe(OK)
		expect(run_entry.exit_code(parts({ verdict: 'already-done' }))).toBe(OK)
	})

	it('exits non-zero on a stopped hold, a spent budget, or an unreadable state', () => {
		expect(run_entry.exit_code(parts({ hold: 'busy', verdict: run_entry.NO_VERDICT }))).toBe(FAILED)
		expect(run_entry.exit_code(parts({ cost: run_entry.COST_OVER }))).toBe(FAILED)
		expect(run_entry.exit_code(parts({ verdict: 'unknown' }))).toBe(FAILED)
	})
})
