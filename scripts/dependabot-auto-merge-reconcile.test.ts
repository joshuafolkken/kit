import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// `gh pr merge --auto` is state that outlives the run that set it, and for four rounds this workflow
// managed it with two steps whose conditions had to be exact complements: one that armed, one that
// withdrew. Nothing enforced the complement — joshuafolkken/kit#840 made it hold by writing one as
// the literal negation of the other, which is a convention rather than a structure. These guards
// hold the structure that replaced it: one decision, one step that acts on it
// (joshuafolkken/kit#845).
const {
	RECONCILE_STEP_ID,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	DECISION_VARIABLE,
	DIAGNOSTIC_VARIABLE,
	MERGE_COMMAND,
	NOT_CANCELLED,
	HEAD_MATCH_FLAG,
	HEAD_SHA_VARIABLE,
	HEAD_SHA_EXPRESSION,
	template_job,
	runtime_job,
	find_step,
	step_run,
	step_condition,
	diagnostic_expression,
} = dependabot_workflow_fixture

const WITHDRAW_COMMAND = 'gh pr merge --disable-auto'
const ARMED_QUERY = '--json autoMergeRequest'
const RECONCILE_LABEL = 'reconciling'
const NOT_FOUND = -1

function reconcile_run(): string {
	return step_run(find_step(template_job(), RECONCILE_STEP_ID))
}

function step_index(step_id: string): number {
	return template_job()?.steps?.findIndex((step) => step.id === step_id) ?? NOT_FOUND
}

function state_changing_steps(): ReadonlyArray<string> {
	return (template_job()?.steps ?? [])
		.filter((step) => {
			const run = step_run(step)

			return run.includes(MERGE_COMMAND) || run.includes(WITHDRAW_COMMAND)
		})
		.map((step) => step.id ?? '')
}

describe('dependabot-auto-merge.yml reconcile — one decision, one actor', () => {
	// The property the collapse exists for. Two steps that change the state have to agree about when
	// each may act; one step cannot disagree with itself.
	it('changes the auto-merge state from exactly one step', () => {
		expect(state_changing_steps()).toEqual([RECONCILE_STEP_ID])
	})

	it('arms and withdraws from that same step', () => {
		const run = reconcile_run()

		expect(run).toContain(MERGE_COMMAND)
		expect(run).toContain(WITHDRAW_COMMAND)
	})

	// Not a decision — it only lets the log say which of the two reasons kept a run from arming. Its
	// absence is silent rather than loud: the script would read an unset variable as "did not answer"
	// and blame the metadata step for every npm advisory and every major, which is the misdiagnosis
	// it exists to prevent.
	it('declares the diagnostic the log branches on', () => {
		const reconcile = find_step(template_job(), RECONCILE_STEP_ID)

		expect(diagnostic_expression(template_job())).not.toBe('')
		expect(step_run(reconcile)).toContain(`"$${DIAGNOSTIC_VARIABLE}"`)
	})

	// The decision is a value the script reads, not a condition that gates a step — which is what
	// lets one step take both directions from it.
	it('takes its direction from the declared decision', () => {
		expect(find_step(template_job(), RECONCILE_STEP_ID)?.env?.[DECISION_VARIABLE]).toBeDefined()
		expect(reconcile_run()).toContain(`"$${DECISION_VARIABLE}"`)
	})

	// `--disable-auto` is an error, not a no-op, on a pull request that has no auto-merge enabled,
	// and `--auto` on one already armed is a needless write. Reading first is what makes the step
	// idempotent in both directions.
	it('reads the current state before either direction', () => {
		const run = reconcile_run()

		expect(run.indexOf(ARMED_QUERY)).toBeGreaterThan(NOT_FOUND)
		expect(run.indexOf(ARMED_QUERY)).toBeLessThan(run.indexOf(MERGE_COMMAND))
		expect(run.indexOf(ARMED_QUERY)).toBeLessThan(run.indexOf(WITHDRAW_COMMAND))
	})
})

describe('dependabot-auto-merge.yml reconcile — the asymmetry between the directions', () => {
	// Failing to arm leaves the bump open for a human. Failing to withdraw leaves an auto-merge armed
	// on a diff nobody re-approved, and this workflow is not a required check, so a red run does not
	// hold the merge back. joshuafolkken/kit#846 builds its retry policy on this difference.
	it('guards only the arming call against a branch that moved', () => {
		const run = reconcile_run()
		const withdraw = run.indexOf(WITHDRAW_COMMAND)

		expect(withdraw).toBeGreaterThan(NOT_FOUND)
		expect(run).toContain(`${HEAD_MATCH_FLAG} "$${HEAD_SHA_VARIABLE}"`)
		expect(run.slice(withdraw)).not.toContain(HEAD_MATCH_FLAG)
	})

	it('names the head the run was triggered for', () => {
		expect(find_step(template_job(), RECONCILE_STEP_ID)?.env?.[HEAD_SHA_VARIABLE]).toBe(
			HEAD_SHA_EXPRESSION,
		)
	})
})

describe('dependabot-auto-merge.yml reconcile — reachability', () => {
	// The upstream-managed check refuses to answer rather than guessing when it cannot read a file,
	// so this step has to be reachable after it failed. Every missing input makes the decision false,
	// so the run reconciles toward "not armed" — the safe side, by the ordinary path.
	it('is reached after an earlier step failed, but not when the run was cancelled', () => {
		const reconcile = find_step(template_job(), RECONCILE_STEP_ID)

		expect(step_condition(reconcile, RECONCILE_LABEL)).toBe(NOT_CANCELLED)
	})

	// `dependabot/fetch-metadata` fails outright on a branch whose first commit is no longer
	// Dependabot's. Containing that failure is what removed both the gate this step used to repeat
	// and the ordering constraint that put the withdrawal ahead of it (joshuafolkken/kit#838).
	it('contains the metadata action’s failure instead of gating around it', () => {
		const metadata = find_step(template_job(), METADATA_STEP_ID)

		expect(metadata?.['continue-on-error']).toBe(true)
		expect(metadata?.if).toBeUndefined()
	})

	// What order remains is data dependency alone: the decision reads both steps' outputs.
	it('runs after the inputs its decision reads', () => {
		expect(step_index(MANAGED_STEP_ID)).toBeGreaterThan(NOT_FOUND)
		expect(step_index(METADATA_STEP_ID)).toBeGreaterThan(NOT_FOUND)
		expect(step_index(RECONCILE_STEP_ID)).toBeGreaterThan(step_index(MANAGED_STEP_ID))
		expect(step_index(RECONCILE_STEP_ID)).toBeGreaterThan(step_index(METADATA_STEP_ID))
	})
})

// In kit `.github/workflows/*` IS the source of truth, so there is no bump to hold back and nothing
// to withdraw — the divergence joshuafolkken/kit#836 introduced, kept intact. Reconciling there would
// newly withdraw an auto-merge a human enabled by hand, for a decision kit's own copy does not even
// make, so it keeps a plain arming step (joshuafolkken/kit#845).
describe('dependabot-auto-merge.yml reconcile is template-only', () => {
	it('leaves kit’s own workflow with nothing that withdraws', () => {
		const runs = runtime_job()?.steps?.map((step) => step_run(step)) ?? []

		expect(runs.length).toBeGreaterThan(0)
		expect(runs.some((run) => run.includes(WITHDRAW_COMMAND))).toBe(false)
		expect(find_step(runtime_job(), RECONCILE_STEP_ID)).toBeUndefined()
	})

	// With nothing to withdraw, kit's copy has no reason to run for anyone else's push, so it keeps
	// the narrower actor guard on the job itself.
	it('keeps the actor guard on kit’s own job, which has nothing to reconcile', () => {
		expect(runtime_job()?.if).toBe(dependabot_workflow_fixture.ACTOR_GATE)
	})
})
