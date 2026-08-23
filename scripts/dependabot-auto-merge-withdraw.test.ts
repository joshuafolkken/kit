import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// joshuafolkken/kit#836 stopped the workflow from *arming* auto-merge on a bump to a kit-distributed
// workflow, but `gh pr merge --auto` is state that persists on the pull request, so a gate that only
// declines to arm cannot undo one that an earlier run already armed. Two routes reach that state: a
// pull request whose diff grows a kit-managed workflow after it was armed, and a push by anyone
// other than Dependabot, which used to skip the whole job. Either way the bump merges itself once
// the checks go green, straight back into the loop #836 closed (joshuafolkken/kit#838).
const {
	WITHDRAW_STEP_ID,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	ACTOR_GATE,
	template_job,
	runtime_job,
	find_step,
	merge_step,
} = dependabot_workflow_fixture

const WITHDRAW_GATE = dependabot_workflow_fixture.managed_gate(true)
const WITHDRAW_COMMAND = 'gh pr merge --disable-auto'
const ARMED_QUERY = '--json autoMergeRequest'
const NOT_FOUND = -1

function withdraw_step_run(): string {
	return find_step(template_job(), WITHDRAW_STEP_ID)?.run ?? ''
}

function template_step_index(step_id: string): number {
	return template_job()?.steps?.findIndex((step) => step.id === step_id) ?? NOT_FOUND
}

describe('dependabot-auto-merge.yml withdrawal', () => {
	it('withdraws auto-merge when a kit-managed workflow is in the diff', () => {
		expect(find_step(template_job(), WITHDRAW_STEP_ID)?.if ?? '').toBe(WITHDRAW_GATE)
		expect(withdraw_step_run()).toContain(WITHDRAW_COMMAND)
	})

	// `--disable-auto` is an error, not a no-op, on a pull request that has no auto-merge enabled —
	// which is the ordinary case here, since the gate normally prevents arming in the first place.
	// Reading `autoMergeRequest` first is what keeps the step from failing the job on every run.
	it('reads the armed state before disabling, so an unarmed pull request is not an error', () => {
		const run = withdraw_step_run()

		expect(run).toContain(ARMED_QUERY)
		expect(run.indexOf(ARMED_QUERY)).toBeLessThan(run.indexOf(WITHDRAW_COMMAND))
	})

	// `dependabot/fetch-metadata` fails the job outright when the first commit is not Dependabot's or
	// is unsigned, and a failed step takes every step after it with it. Withdrawal placed after it
	// would therefore be unreachable in exactly the hand-amended-branch case that motivates it.
	it('withdraws before the metadata step, which can fail the job', () => {
		expect(template_step_index(MANAGED_STEP_ID)).toBeGreaterThan(NOT_FOUND)
		expect(template_step_index(WITHDRAW_STEP_ID)).toBeGreaterThan(
			template_step_index(MANAGED_STEP_ID),
		)
		expect(template_step_index(METADATA_STEP_ID)).toBeGreaterThan(
			template_step_index(WITHDRAW_STEP_ID),
		)
	})

	// The job guard moved to the pull request's author so that a push by someone else still reaches
	// the withdrawal above. Arming is the half that must stay Dependabot's own event: such a push
	// carries commits nobody reviewed as part of the bump, so the actor check moved onto this step
	// rather than disappearing.
	it('still arms auto-merge only on Dependabot’s own events', () => {
		expect(merge_step(template_job())?.if ?? '').toContain(ACTOR_GATE)
	})

	// `dependabot/fetch-metadata` fails the job when the branch's first commit is no longer
	// Dependabot's — a maintainer who amended or rebased the bump by hand. The job now reaches that
	// run, so without this gate the wider guard would turn their pull request red.
	it('reads metadata only on Dependabot’s own events, which cannot fail the job', () => {
		expect(find_step(template_job(), METADATA_STEP_ID)?.if ?? '').toContain(ACTOR_GATE)
	})
})

// In kit `.github/workflows/*` IS the source of truth, so there is no bump to hold back and nothing
// to withdraw — the divergence #836 introduced, kept intact.
describe('dependabot-auto-merge.yml withdrawal is template-only', () => {
	it('is absent from kit’s own runtime workflow', () => {
		const runs = runtime_job()?.steps?.map((step) => step.run ?? '') ?? []

		expect(runs.length).toBeGreaterThan(0)
		expect(find_step(runtime_job(), WITHDRAW_STEP_ID)).toBeUndefined()
		expect(runs.some((run) => run.includes(WITHDRAW_COMMAND))).toBe(false)
	})

	// With nothing to withdraw, the runtime workflow has no reason to run for anyone else's push, so
	// it keeps the narrower actor guard on the job itself.
	it('keeps the actor guard on kit’s own job, which has nothing to withdraw', () => {
		expect(runtime_job()?.if).toBe(ACTOR_GATE)
	})
})
