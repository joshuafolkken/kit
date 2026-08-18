import { data, Evaluator, Lexer, Parser } from '@actions/expressions'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'

// `.github/workflows/dependabot-auto-merge.yml` decides which Dependabot PRs merge unattended, so
// the gate is asserted by evaluating the workflow's own `if` expression with GitHub's expression
// engine rather than by matching substrings: a text match proves the condition was written, not
// that an npm or major update is unable to reach the merge step (kit#802).
//
// The workflow is loaded through ci_yml_fixture, the shared reader for every `.github/workflows`
// guard in this package — its loader and step/job types are generic despite the CI-flavoured name.
const WORKFLOW_PATH = '.github/workflows/dependabot-auto-merge.yml'
const MERGE_JOB = 'auto-merge'
const MERGE_COMMAND = 'gh pr merge --auto'
const DEPENDABOT_ACTOR_GATE = "github.actor == 'dependabot[bot]'"

// The context root the workflow reads, split into the parts the expression addresses so the
// evaluated context and the asserted reference path cannot drift apart.
const CONTEXT_ROOT = 'steps'
const METADATA_STEP = 'metadata'
const OUTPUTS_KEY = 'outputs'
const ECOSYSTEM_OUTPUT = 'package-ecosystem'
const UPDATE_TYPE_OUTPUT = 'update-type'
const ECOSYSTEM_REFERENCE = `${CONTEXT_ROOT}.${METADATA_STEP}.${OUTPUTS_KEY}.${ECOSYSTEM_OUTPUT}`

const ACTIONS_ECOSYSTEM = 'github_actions'
const NPM_ECOSYSTEM = 'npm_and_yarn'
const PATCH_UPDATE = 'version-update:semver-patch'
const MINOR_UPDATE = 'version-update:semver-minor'
const MAJOR_UPDATE = 'version-update:semver-major'

function find_merge_job(): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(WORKFLOW_PATH, MERGE_JOB)
}

function find_merge_step(): WorkflowStep | undefined {
	return find_merge_job()?.steps?.find((step) => step.run?.includes(MERGE_COMMAND) === true)
}

function read_merge_condition(): string {
	const condition = find_merge_step()?.if
	if (condition === undefined) throw new Error('the auto-merge step declares no `if` condition')

	return condition
}

// Mirrors the `steps.<id>.outputs.<name>` shape the workflow reads, so the expression under test is
// evaluated against the same context GitHub supplies at run time.
function build_metadata_context(ecosystem: string, update_type: string): data.Dictionary {
	const outputs = new data.Dictionary(
		{ key: ECOSYSTEM_OUTPUT, value: new data.StringData(ecosystem) },
		{ key: UPDATE_TYPE_OUTPUT, value: new data.StringData(update_type) },
	)
	const metadata = new data.Dictionary({ key: OUTPUTS_KEY, value: outputs })

	return new data.Dictionary({
		key: CONTEXT_ROOT,
		value: new data.Dictionary({ key: METADATA_STEP, value: metadata }),
	})
}

function is_merge_step_reached(ecosystem: string, update_type: string): boolean {
	const lexed = new Lexer(read_merge_condition()).lex()
	const parsed = new Parser(lexed.tokens, [CONTEXT_ROOT], []).parse()
	const result = new Evaluator(parsed, build_metadata_context(ecosystem, update_type)).evaluate()
	if (result.kind !== data.Kind.Boolean) throw new Error('the gate is not a boolean expression')

	return result.value
}

describe('dependabot-auto-merge.yml — gate shape (kit#802)', () => {
	it('keeps a step that enables auto-merge on the pull request', () => {
		expect(find_merge_step()).toBeDefined()
	})

	it('runs the job only for Dependabot-authored pull requests', () => {
		expect(find_merge_job()?.if).toContain(DEPENDABOT_ACTOR_GATE)
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
