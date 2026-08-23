import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture, type WorkflowRun } from './dependabot-workflow-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

// The same treatment `dependabot-auto-merge.test.ts` gives kit's own workflow, applied to the copy
// consumers receive — whose gate carries two clauses kit's does not: the kit-managed decision
// (joshuafolkken/kit#836) and the actor check that moved here when the job's own guard widened to
// the pull request's author (joshuafolkken/kit#838). A substring match proves those clauses were
// written; only an evaluation proves that a bump cannot reach the step they guard.
const {
	DEPENDABOT_LOGIN,
	MAINTAINER_LOGIN,
	ACTIONS_ECOSYSTEM,
	NPM_ECOSYSTEM,
	PATCH_UPDATE,
	MINOR_UPDATE,
	MAJOR_UPDATE,
	NO_OUTPUT,
	MANAGED,
	NOT_MANAGED,
	build_run_context,
	template_job,
	merge_condition,
} = dependabot_workflow_fixture

function is_merge_step_reached(run: WorkflowRun): boolean {
	return workflow_expression_fixture.evaluate_condition(
		merge_condition(template_job()),
		build_run_context(run),
	)
}

// A bump Dependabot opened against a workflow the consumer owns: the ordinary case, and the one the
// distribution exists for.
function consumer_owned_bump(update_type: string): WorkflowRun {
	return {
		actor: DEPENDABOT_LOGIN,
		managed_output: NOT_MANAGED,
		ecosystem: ACTIONS_ECOSYSTEM,
		update_type,
	}
}

describe('dependabot-auto-merge.yml template gate — reachable updates', () => {
	it.each([PATCH_UPDATE, MINOR_UPDATE])(
		'auto-merges a github-actions %s update to a workflow the consumer owns',
		(update_type) => {
			expect(is_merge_step_reached(consumer_owned_bump(update_type))).toBe(true)
		},
	)

	it('never auto-merges a github-actions major update', () => {
		expect(is_merge_step_reached(consumer_owned_bump(MAJOR_UPDATE))).toBe(false)
	})

	// The distributed `.github/dependabot.yml` disables npm version updates, so the only npm pull
	// request that reaches this workflow is a security advisory — the kind a human should read.
	it.each([PATCH_UPDATE, MINOR_UPDATE, MAJOR_UPDATE])(
		'never auto-merges an npm %s update',
		(update_type) => {
			expect(
				is_merge_step_reached({ ...consumer_owned_bump(update_type), ecosystem: NPM_ECOSYSTEM }),
			).toBe(false)
		},
	)
})

describe('dependabot-auto-merge.yml template gate — held-back updates', () => {
	// The metadata step is skipped for a kit-managed diff, and a skipped step publishes no outputs —
	// so the run this models is the one that actually happens, not a hypothetical one where the gate
	// sees a well-formed bump it must reject on the managed clause alone.
	it('never auto-merges a bump to a kit-managed workflow', () => {
		expect(
			is_merge_step_reached({
				actor: DEPENDABOT_LOGIN,
				managed_output: MANAGED,
				ecosystem: NO_OUTPUT,
				update_type: NO_OUTPUT,
			}),
		).toBe(false)
	})

	// The job now runs for a push by someone other than Dependabot, so that a kit-managed workflow
	// entering the diff still withdraws an auto-merge armed earlier. Arming must not widen with it:
	// such a push carries commits nobody reviewed as part of the bump.
	it('never arms auto-merge on a push by anyone other than Dependabot', () => {
		expect(
			is_merge_step_reached({ ...consumer_owned_bump(PATCH_UPDATE), actor: MAINTAINER_LOGIN }),
		).toBe(false)
	})
})
