import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

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
	runtime_job,
	merge_step,
} = dependabot_workflow_fixture
const { STEPS_CONTEXT: CONTEXT_ROOT, OUTPUTS_KEY } = workflow_expression_fixture

// The metadata outputs the expression addresses, spelled out so the evaluated context and the
// asserted reference path cannot drift apart.
const ECOSYSTEM_OUTPUT = 'package-ecosystem'
const UPDATE_TYPE_OUTPUT = 'update-type'
const ECOSYSTEM_REFERENCE = `${CONTEXT_ROOT}.${METADATA_STEP}.${OUTPUTS_KEY}.${ECOSYSTEM_OUTPUT}`

const ACTIONS_ECOSYSTEM = 'github_actions'
const NPM_ECOSYSTEM = 'npm_and_yarn'
const PATCH_UPDATE = 'version-update:semver-patch'
const MINOR_UPDATE = 'version-update:semver-minor'
const MAJOR_UPDATE = 'version-update:semver-major'

function read_merge_condition(): string {
	const condition = merge_step(runtime_job())?.if
	if (condition === undefined) throw new Error('the auto-merge step declares no `if` condition')

	return condition
}

// Mirrors the `steps.<id>.outputs.<name>` shape the workflow reads, so the expression under test is
// evaluated against the same context GitHub supplies at run time.
function build_metadata_context(ecosystem: string, update_type: string): ContextTree {
	return {
		[CONTEXT_ROOT]: {
			[METADATA_STEP]: {
				[OUTPUTS_KEY]: { [ECOSYSTEM_OUTPUT]: ecosystem, [UPDATE_TYPE_OUTPUT]: update_type },
			},
		},
	}
}

function is_merge_step_reached(ecosystem: string, update_type: string): boolean {
	return workflow_expression_fixture.evaluate_condition(
		read_merge_condition(),
		build_metadata_context(ecosystem, update_type),
	)
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
		expect(read_merge_condition()).toContain(ECOSYSTEM_REFERENCE)
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
