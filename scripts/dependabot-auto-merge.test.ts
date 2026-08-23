import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

// `.github/workflows/dependabot-auto-merge.yml` decides which Dependabot PRs merge unattended, so
// the gate is asserted by evaluating the workflow's own `if` expression with GitHub's expression
// engine rather than by matching substrings: a text match proves the condition was written, not
// that an npm or major update is unable to reach the merge step (kit#802).
//
// The workflow, its job and its step ids come from dependabot_workflow_fixture, shared with the
// guards on the copy consumers receive so the two cannot address different steps.
const {
	ACTOR_GATE: DEPENDABOT_ACTOR_GATE,
	METADATA_STEP_ID: METADATA_STEP,
	DEPENDABOT_LOGIN,
	ECOSYSTEM_OUTPUT,
	ACTIONS_ECOSYSTEM,
	NPM_ECOSYSTEM,
	PATCH_UPDATE,
	MINOR_UPDATE,
	MAJOR_UPDATE,
	NO_OUTPUT,
	build_run_context,
	runtime_job,
	merge_step,
	merge_condition,
} = dependabot_workflow_fixture
const { STEPS_CONTEXT: CONTEXT_ROOT, OUTPUTS_KEY } = workflow_expression_fixture

// The reference path the expression addresses, assembled from the same pieces the evaluated context
// is built from so the two cannot drift apart.
const ECOSYSTEM_REFERENCE = `${CONTEXT_ROOT}.${METADATA_STEP}.${OUTPUTS_KEY}.${ECOSYSTEM_OUTPUT}`

// kit's own gate reads no actor and no kit-managed decision — that divergence is the point of
// joshuafolkken/kit#836 — so a run is described here by the metadata outputs alone; the rest of the
// shared context is inert.
function is_merge_step_reached(ecosystem: string, update_type: string): boolean {
	const context = build_run_context({
		actor: DEPENDABOT_LOGIN,
		managed_output: NO_OUTPUT,
		ecosystem,
		update_type,
	})

	return workflow_expression_fixture.evaluate_condition(merge_condition(runtime_job()), context)
}

describe('dependabot-auto-merge.yml — gate shape (kit#802)', () => {
	it('keeps a step that enables auto-merge on the pull request', () => {
		expect(merge_step(runtime_job())).toBeDefined()
	})

	it('runs the job only for Dependabot-authored pull requests', () => {
		expect(runtime_job()?.if).toContain(DEPENDABOT_ACTOR_GATE)
	})

	// `dependency-type` reports `direct:production` for github-actions updates and for kit's npm
	// production dependencies alike, so the ecosystem output is the only signal separating them.
	it('discriminates on package-ecosystem', () => {
		expect(merge_condition(runtime_job())).toContain(ECOSYSTEM_REFERENCE)
	})
})

describe('dependabot-auto-merge.yml — reachable updates (kit#802)', () => {
	// These are the action SHA pins `josh sync` distributes; keeping them current at the source is
	// the intended flow, and kit's own CI fully covers them.
	it.each([PATCH_UPDATE, MINOR_UPDATE])('auto-merges a github-actions %s update', (update_type) => {
		expect(is_merge_step_reached(ACTIONS_ECOSYSTEM, update_type)).toBe(true)
	})

	// kit publishes lint plugins as runtime dependencies, so an npm patch can change rule behavior
	// for every consumer while kit's own CI only proves that kit still builds.
	it.each([PATCH_UPDATE, MINOR_UPDATE, MAJOR_UPDATE])(
		'never auto-merges an npm %s update',
		(update_type) => {
			expect(is_merge_step_reached(NPM_ECOSYSTEM, update_type)).toBe(false)
		},
	)

	it('never auto-merges a github-actions major update', () => {
		expect(is_merge_step_reached(ACTIONS_ECOSYSTEM, MAJOR_UPDATE)).toBe(false)
	})
})
