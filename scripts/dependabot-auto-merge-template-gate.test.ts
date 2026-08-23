import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// The same treatment `dependabot-auto-merge.test.ts` gives kit's own workflow, applied to the copy
// consumers receive — whose gate carries two clauses kit's does not: the kit-managed decision
// (joshuafolkken/kit#836) and the actor check that moved here when the job's own guard widened to
// the pull request's author (joshuafolkken/kit#838). A substring match proves those clauses were
// written; only an evaluation proves that a bump cannot reach the step they guard.
const {
	DEPENDABOT_LOGIN,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	MANAGED_OUTPUT,
	template_job,
	merge_step,
} = dependabot_workflow_fixture
const { STEPS_CONTEXT, GITHUB_CONTEXT, OUTPUTS_KEY } = workflow_expression_fixture

const ECOSYSTEM_OUTPUT = 'package-ecosystem'
const UPDATE_TYPE_OUTPUT = 'update-type'

const ACTIONS_ECOSYSTEM = 'github_actions'
const NPM_ECOSYSTEM = 'npm_and_yarn'
const PATCH_UPDATE = 'version-update:semver-patch'
const MINOR_UPDATE = 'version-update:semver-minor'
const MAJOR_UPDATE = 'version-update:semver-major'

const MAINTAINER_LOGIN = 'joshuafolkken'
const NO_OUTPUT = ''

interface Run {
	actor: string
	has_kit_managed: boolean
	ecosystem: string
	update_type: string
}

function build_context(run: Run): ContextTree {
	return {
		[GITHUB_CONTEXT]: { actor: run.actor },
		[STEPS_CONTEXT]: {
			[METADATA_STEP_ID]: {
				[OUTPUTS_KEY]: {
					[ECOSYSTEM_OUTPUT]: run.ecosystem,
					[UPDATE_TYPE_OUTPUT]: run.update_type,
				},
			},
			[MANAGED_STEP_ID]: {
				[OUTPUTS_KEY]: { [MANAGED_OUTPUT]: String(run.has_kit_managed) },
			},
		},
	}
}

function read_merge_condition(): string {
	const condition = merge_step(template_job())?.if
	if (condition === undefined) throw new Error('the auto-merge step declares no `if` condition')

	return condition
}

function is_merge_step_reached(run: Run): boolean {
	return workflow_expression_fixture.evaluate_condition(read_merge_condition(), build_context(run))
}

// A bump Dependabot opened against a workflow the consumer owns: the ordinary case, and the one the
// distribution exists for.
function consumer_owned_bump(update_type: string): Run {
	return {
		actor: DEPENDABOT_LOGIN,
		has_kit_managed: false,
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
				has_kit_managed: true,
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
