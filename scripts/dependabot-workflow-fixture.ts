import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

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

// The step ids the conditions address, and the gate every guard on the kit-managed decision is
// built from. Derived in one place so a rename cannot leave a guard asserting on a step id the
// workflow no longer uses — which would pass vacuously rather than fail.
const METADATA_STEP_ID = 'metadata'
const MANAGED_STEP_ID = 'managed'
const MANAGED_OUTPUT = 'has-kit-managed'
const WITHDRAW_STEP_ID = 'withdraw'
const DEPENDABOT_LOGIN = 'dependabot[bot]'
const ACTOR_GATE = `${workflow_expression_fixture.GITHUB_CONTEXT}.actor == '${DEPENDABOT_LOGIN}'`

function managed_gate(has_kit_managed: boolean): string {
	const { STEPS_CONTEXT, OUTPUTS_KEY } = workflow_expression_fixture

	return `${STEPS_CONTEXT}.${MANAGED_STEP_ID}.${OUTPUTS_KEY}.${MANAGED_OUTPUT} == '${String(has_kit_managed)}'`
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

function merge_step(target: WorkflowJob | undefined): WorkflowStep | undefined {
	return target?.steps?.find((step) => (step.run ?? '').includes(MERGE_COMMAND))
}

const dependabot_workflow_fixture = {
	TEMPLATE,
	RUNTIME,
	JOB,
	MERGE_COMMAND,
	METADATA_STEP_ID,
	MANAGED_STEP_ID,
	MANAGED_OUTPUT,
	WITHDRAW_STEP_ID,
	DEPENDABOT_LOGIN,
	ACTOR_GATE,
	managed_gate,
	template_job,
	runtime_job,
	find_step,
	merge_step,
}

export { dependabot_workflow_fixture }
