import { run_entry } from '#scripts/run/entry/run-entry'
import { run_event_step } from '#scripts/run/event/run-event-step'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_step } from './run-step'
import { run_step_progress } from './run-step-progress'

// joshuafolkken/kit#6598: the fullrun step a computed position stands at.

const { STEP } = run_event_step
const KIND = run_event_stream.EVENT_KIND
const { step_of } = run_step_progress

describe('run_step_progress.step_of', () => {
	it('reads the pre-implementation verdicts as the steps before and at the first edit', () => {
		expect(step_of(run_step.UPDATE_DEPS)).toBe(STEP.UPDATE_DEPS)
		expect(step_of(run_step.IMPLEMENT, KIND.PLAN)).toBe(STEP.IMPLEMENT)
		expect(step_of(run_step.HUMAN_REVIEW)).toBe(STEP.IMPLEMENT)
		expect(step_of(run_entry.GATE_VERDICT)).toBe(STEP.GATE)
	})

	it('reads the newest event as the step after the implementation', () => {
		expect(step_of('pnpm josh ship --review', KIND.REVIEW_ROUND)).toBe(STEP.GATE)
		expect(step_of('pnpm josh followup', KIND.PR_OPENED)).toBe(STEP.FOLLOWUP)
	})

	it('names no step for a position outside the fullrun steps', () => {
		expect(step_of(run_step.STOP, KIND.MERGE)).toBeUndefined()
		// The ship's own stage lines are the newer words on the board; a step written over them hides a failure.
		expect(step_of(run_step.WAIT, KIND.SHIP_LAUNCH)).toBeUndefined()
		expect(step_of(run_step.WAIT, KIND.SHIP_STOP)).toBeUndefined()
		expect(step_of(run_step.UNKNOWN)).toBeUndefined()
	})
})
