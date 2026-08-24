import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// The two copies of the auto-merge workflow. They diverge on purpose: in kit
// `.github/workflows/*` IS the source every action pin is resolved from, so a bump merged here is
// the update every consumer then receives, while in a consumer the same files are rewritten from
// the installed kit package on the next `josh sync` (joshuafolkken/kit#836).
const TEMPLATE = 'templates/workflows/dependabot-auto-merge.yml'
const RUNTIME = '.github/workflows/dependabot-auto-merge.yml'
const JOB = 'auto-merge'

// The command `josh doctor` matches to decide whether the repository auto-merge prerequisite
// applies. Identifying the arming step by it rather than by name keeps every guard built on it
// pointed at the step that actually arms auto-merge.
const MERGE_COMMAND = 'gh pr merge --auto --merge'

// The step ids the conditions address, and the gate every guard on the upstream-managed decision is
// built from. Derived in one place so a rename cannot leave a guard asserting on a step id the
// workflow no longer uses — which would pass vacuously rather than fail.
const METADATA_STEP_ID = 'metadata'
const MANAGED_STEP_ID = 'managed'
// Named for the question it answers: whether some upstream package overwrites one of the workflows
// in the diff. kit is one such package, but a repository can receive workflows from more than one
// (joshuafolkken/kit#844), so the decision is not kit's alone.
const MANAGED_OUTPUT = 'has-upstream-managed'
const RECONCILE_STEP_ID = 'reconcile'

// The decision, and where it lives. It is an `env` value rather than a step condition because a
// condition gates a step while this has to be a *value* the reconciling script reads — and it stays
// an expression rather than shell so that GitHub's own engine evaluates it and these guards can
// evaluate the very same string (joshuafolkken/kit#845).
const DECISION_VARIABLE = 'SHOULD_BE_ARMED'
// The narrower half: whether this *run* may decide at all, as opposed to whether this *bump*
// qualifies. The withdrawal keys on this one, so a bump that merely falls outside the policy — an
// npm advisory, a major — is left as it is, including an auto-merge a maintainer enabled by hand.
const ENTITLEMENT_VARIABLE = 'MAY_ARM'
// Not a decision — it only lets the reconciling step's log say which of the two reasons kept a run
// from arming, so a broken metadata action is not mistaken for a queue of bumps that do not qualify.
const DIAGNOSTIC_VARIABLE = 'METADATA_ANSWERED'
const EXPRESSION_OPEN = '${{'
const EXPRESSION_CLOSE = '}}'

// The concurrency both copies declare. `github.ref` is the pull request's own merge ref, so the
// group is per pull request: a superseded run is cancelled without one bump delaying another's
// (joshuafolkken/kit#842). Declared once here so the two copies cannot drift into different
// groupings, which would leave one of them running its bumps in parallel while its guard passed.
const CONCURRENCY_GROUP = '${{ github.workflow }}-${{ github.ref }}'

// How the arming step refuses to act on a branch that moved under it. The flag travels to GitHub as
// the auto-merge mutation's `expectedHeadOid`, so the arming is conditional on the head server-side
// rather than on a read this step performed first — nothing can land in between.
const HEAD_MATCH_FLAG = '--match-head-commit'
const HEAD_SHA_VARIABLE = 'HEAD_SHA'
const HEAD_SHA_EXPRESSION = '${{ github.event.pull_request.head.sha }}'
const DEPENDABOT_LOGIN = 'dependabot[bot]'
const MAINTAINER_LOGIN = 'joshuafolkken'
const ACTOR_GATE = `${workflow_expression_fixture.GITHUB_CONTEXT}.actor == '${DEPENDABOT_LOGIN}'`

// The metadata outputs the conditions address, and the values Dependabot publishes in them. Spelled
// out here rather than in each suite so the context a condition is evaluated against and the
// reference paths asserted on cannot drift apart between the copies of the workflow.
const ECOSYSTEM_OUTPUT = 'package-ecosystem'
const UPDATE_TYPE_OUTPUT = 'update-type'
const ACTIONS_ECOSYSTEM = 'github_actions'
const NPM_ECOSYSTEM = 'npm_and_yarn'
const PATCH_UPDATE = 'version-update:semver-patch'
const MINOR_UPDATE = 'version-update:semver-minor'
const MAJOR_UPDATE = 'version-update:semver-major'

// A step that was skipped or that failed publishes no outputs, and GitHub renders every missing
// reference as the empty string — so this is what a condition reads for a step that never answered.
const NO_OUTPUT = ''
const MANAGED = 'true'
const NOT_MANAGED = 'false'

// `managed_output` is the raw value the upstream-managed check published, not a boolean: besides `true`
// and `false` it can be absent entirely, which is how a failed check reads.
interface WorkflowRun {
	actor: string
	managed_output: string
	ecosystem: string
	update_type: string
}

function managed_gate(has_kit_managed: boolean): string {
	const { STEPS_CONTEXT, OUTPUTS_KEY } = workflow_expression_fixture

	return `${STEPS_CONTEXT}.${MANAGED_STEP_ID}.${OUTPUTS_KEY}.${MANAGED_OUTPUT} == '${String(has_kit_managed)}'`
}

// The one gate left on a step. Everything about *which* updates may arm now lives in the decision
// expression; this only decides whether the reconciling step runs at all, and it runs whenever the
// pull request could still be carrying state to correct (joshuafolkken/kit#845).
const NOT_CANCELLED = '!cancelled()'

// Mirrors the `github.<field>` and `steps.<id>.outputs.<name>` shapes the workflow reads, so every
// condition under test is evaluated against the same context GitHub supplies at run time. A
// condition that names none of a given step's outputs simply never reads them.
function build_run_context(run: WorkflowRun): ContextTree {
	const { STEPS_CONTEXT, GITHUB_CONTEXT, OUTPUTS_KEY } = workflow_expression_fixture
	const metadata = {
		[ECOSYSTEM_OUTPUT]: run.ecosystem,
		[UPDATE_TYPE_OUTPUT]: run.update_type,
	}

	return {
		[GITHUB_CONTEXT]: { actor: run.actor },
		[STEPS_CONTEXT]: {
			[METADATA_STEP_ID]: { [OUTPUTS_KEY]: metadata },
			[MANAGED_STEP_ID]: { [OUTPUTS_KEY]: { [MANAGED_OUTPUT]: run.managed_output } },
		},
	}
}

function job(relative_path: string): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(relative_path, JOB)
}

function template_job(): WorkflowJob | undefined {
	return job(TEMPLATE)
}

function runtime_job(): WorkflowJob | undefined {
	return job(RUNTIME)
}

function find_step(target: WorkflowJob | undefined, step_id: string): WorkflowStep | undefined {
	return target?.steps?.find((step) => step.id === step_id)
}

// A step with no `run` reads as the empty script rather than as `undefined`, so a `toContain` guard
// on it fails on a missing step instead of throwing.
function step_run(step: WorkflowStep | undefined): string {
	return step?.run ?? ''
}

function merge_step(target: WorkflowJob | undefined): WorkflowStep | undefined {
	return target?.steps?.find((step) => (step.run ?? '').includes(MERGE_COMMAND))
}

// The decision as GitHub will evaluate it, with the `${{ }}` wrapper removed so the expression
// engine can parse it. Read off the step rather than restated here, so a guard cannot pass against
// a decision the workflow no longer carries.
function unwrap_expression(declared: string): string | undefined {
	const open = declared.indexOf(EXPRESSION_OPEN)
	const close = declared.lastIndexOf(EXPRESSION_CLOSE)
	if (open === -1 || close <= open) return undefined

	return declared.slice(open + EXPRESSION_OPEN.length, close).trim()
}

// Reported apart for the same reason as `step_condition` below: a missing step means a guard is
// addressing one the workflow no longer has, a missing declaration means the decision moved out of
// the expression, and the two are fixed differently.
function declared_expression(target: WorkflowJob | undefined, variable: string): string {
	const step = find_step(target, RECONCILE_STEP_ID)
	if (step === undefined) throw new Error('the workflow declares no reconciling step')

	const declared = step.env?.[variable]
	if (declared === undefined) throw new Error(`the reconciling step declares no ${variable}`)

	const expression = unwrap_expression(declared)
	if (expression === undefined) throw new Error(`${variable} is not an expression`)

	return expression
}

function decision_expression(target: WorkflowJob | undefined): string {
	return declared_expression(target, DECISION_VARIABLE)
}

function entitlement_expression(target: WorkflowJob | undefined): string {
	return declared_expression(target, ENTITLEMENT_VARIABLE)
}

function diagnostic_expression(target: WorkflowJob | undefined): string {
	return declared_expression(target, DIAGNOSTIC_VARIABLE)
}

// A step that is absent and one that carries no `if` are reported apart, because the fixes differ:
// the first means a guard is addressing a step id the workflow no longer uses, the second that the
// step now runs unconditionally. Neither may be read as the empty string, which would evaluate to
// the opposite of the truth.
function step_condition(step: WorkflowStep | undefined, label: string): string {
	if (step === undefined) throw new Error(`the workflow declares no ${label} step`)
	if (step.if === undefined) throw new Error(`the ${label} step declares no \`if\` condition`)

	return step.if
}

// Names the arming step in the errors above. "arming" rather than "auto-merge" both because the job
// already carries that name and because it is the vocabulary the two halves' guards are written in.
const MERGE_STEP_LABEL = 'arming'

function merge_condition(target: WorkflowJob | undefined): string {
	return step_condition(merge_step(target), MERGE_STEP_LABEL)
}

const dependabot_workflow_fixture = {
	TEMPLATE,
	RUNTIME,
	JOB,
	MERGE_COMMAND,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	MANAGED_OUTPUT,
	RECONCILE_STEP_ID,
	DECISION_VARIABLE,
	ENTITLEMENT_VARIABLE,
	DIAGNOSTIC_VARIABLE,
	DEPENDABOT_LOGIN,
	MAINTAINER_LOGIN,
	ACTOR_GATE,
	NOT_CANCELLED,
	CONCURRENCY_GROUP,
	HEAD_MATCH_FLAG,
	HEAD_SHA_VARIABLE,
	HEAD_SHA_EXPRESSION,
	ECOSYSTEM_OUTPUT,
	UPDATE_TYPE_OUTPUT,
	ACTIONS_ECOSYSTEM,
	NPM_ECOSYSTEM,
	PATCH_UPDATE,
	MINOR_UPDATE,
	MAJOR_UPDATE,
	NO_OUTPUT,
	MANAGED,
	NOT_MANAGED,
	managed_gate,
	decision_expression,
	entitlement_expression,
	diagnostic_expression,
	build_run_context,
	template_job,
	runtime_job,
	find_step,
	merge_step,
	step_run,
	step_condition,
	merge_condition,
}

export { dependabot_workflow_fixture, type WorkflowRun }
