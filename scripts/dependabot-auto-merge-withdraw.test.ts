import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

// joshuafolkken/kit#836 stopped the workflow from *arming* auto-merge on a bump to a kit-distributed
// workflow, but `gh pr merge --auto` is state that persists on the pull request, so a gate that only
// declines to arm cannot undo one that an earlier run already armed. #838 added the withdrawal and
// enumerated one route into that state — a diff that grew a kit-managed workflow — which left the
// other one, a push by anyone but Dependabot, uncovered for a diff kit never overwrites
// (joshuafolkken/kit#840). The withdrawal is now the negation of the condition that lets a run
// consider arming at all, so every run that cannot arm withdraws instead, and it is prefixed with
// `!cancelled()` so a failed kit-managed check falls to the safe side rather than leaving the
// auto-merge armed behind a red job.
const {
	WITHDRAW_STEP_ID,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	DEPENDABOT_LOGIN,
	MAINTAINER_LOGIN,
	ACTOR_GATE,
	ARM_PRECONDITION,
	NOT_CANCELLED,
	NO_OUTPUT,
	MANAGED,
	NOT_MANAGED,
	withdraw_gate,
	build_run_context,
	template_job,
	runtime_job,
	find_step,
	merge_step,
	step_run,
	step_condition,
} = dependabot_workflow_fixture

const WITHDRAW_STEP_LABEL = 'withdrawal'
const WITHDRAW_COMMAND = 'gh pr merge --disable-auto'
const ARMED_QUERY = '--json autoMergeRequest'
const NOT_FOUND = -1

function withdraw_step_run(): string {
	return step_run(find_step(template_job(), WITHDRAW_STEP_ID))
}

function withdraw_condition(): string {
	return step_condition(find_step(template_job(), WITHDRAW_STEP_ID), WITHDRAW_STEP_LABEL)
}

// The withdrawal names no metadata output, so a run is described here by the two facts it does
// read: who triggered it, and what the kit-managed check answered — `NO_OUTPUT` being the answer of
// a check that failed before publishing one.
function is_withdrawn(actor: string, managed_output: string): boolean {
	const context = build_run_context({
		actor,
		managed_output,
		ecosystem: NO_OUTPUT,
		update_type: NO_OUTPUT,
	})

	return workflow_expression_fixture.evaluate_condition(withdraw_condition(), context)
}

function template_step_index(step_id: string): number {
	return template_job()?.steps?.findIndex((step) => step.id === step_id) ?? NOT_FOUND
}

describe('dependabot-auto-merge.yml withdrawal — which runs withdraw', () => {
	// The route joshuafolkken/kit#838 closed: armed on `opened` while the diff held nothing kit
	// overwrites, then a later push adds a kit-managed workflow to it.
	it('withdraws when a kit-managed workflow is in the diff', () => {
		expect(is_withdrawn(DEPENDABOT_LOGIN, MANAGED)).toBe(true)
	})

	// The route joshuafolkken/kit#840 closed. The job runs for this push — it is gated on the pull
	// request's author, still Dependabot — but the enumerated withdrawal skipped it, and so did
	// arming, so an auto-merge armed earlier survived a rebase or an amend nobody reviewed.
	it('withdraws on a push by anyone other than Dependabot, even outside the kit-managed set', () => {
		expect(is_withdrawn(MAINTAINER_LOGIN, NOT_MANAGED)).toBe(true)
	})

	// `KIT_MANAGED_WORKFLOWS` empty, or a `gh api` call that did not answer. This workflow is not a
	// required check, so a red run of it does not hold the merge back — leaving the armed state in
	// place would ship exactly what the check exists to prevent.
	it('withdraws when the kit-managed check failed and published no output', () => {
		expect(is_withdrawn(DEPENDABOT_LOGIN, NO_OUTPUT)).toBe(true)
	})

	// The ordinary case the distribution exists for, and the only run that arms anything.
	it('leaves auto-merge alone on a Dependabot bump outside the kit-managed set', () => {
		expect(is_withdrawn(DEPENDABOT_LOGIN, NOT_MANAGED)).toBe(false)
	})
})

describe('dependabot-auto-merge.yml withdrawal — shape', () => {
	// Both halves are pinned to one declared precondition rather than to each other's text, so a
	// case added to arming is withdrawn without a second edit and the two cannot disagree.
	it('is the negation of the condition arming requires', () => {
		expect(find_step(template_job(), METADATA_STEP_ID)?.if).toBe(ARM_PRECONDITION)
		expect(withdraw_condition()).toBe(withdraw_gate(ARM_PRECONDITION))
	})

	// Without it the job stops at a failed kit-managed check with the auto-merge still armed.
	// `always()` in its place would reach a cancelled run too, where the check was interrupted rather
	// than answered — and withdraw a legitimately armed auto-merge that nothing re-arms.
	it('is reached when an earlier step failed, but not when the run was cancelled', () => {
		expect(withdraw_condition().startsWith(NOT_CANCELLED)).toBe(true)
	})

	it('disables auto-merge on the pull request', () => {
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
})

// In kit `.github/workflows/*` IS the source of truth, so there is no bump to hold back and nothing
// to withdraw — the divergence #836 introduced, kept intact.
describe('dependabot-auto-merge.yml withdrawal is template-only', () => {
	it('is absent from kit’s own runtime workflow', () => {
		const runs = runtime_job()?.steps?.map((step) => step_run(step)) ?? []

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
