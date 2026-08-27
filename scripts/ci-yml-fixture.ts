import { readFileSync } from 'node:fs'
import { package_path } from './init/init-paths'
import { yaml_config_fixture } from './yaml-config-fixture'

// GitHub spells some workflow keys in kebab-case. They are declared verbatim — with the naming
// rule disabled on the line, as elsewhere for external field names — rather than reached through
// an index signature, which would silently turn every misspelled key in these guards into
// `undefined` and make a `toBeUndefined()` assertion pass without testing anything.
interface WorkflowStep {
	id?: string
	name?: string
	if?: string
	env?: Record<string, string>
	run?: string
	uses?: string
	with?: Record<string, string | number>
	// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub workflow key
	'continue-on-error'?: string | boolean
}

interface WorkflowJob {
	container?: unknown
	env?: Record<string, string>
	if?: string
	outputs?: Record<string, string>
	needs?: string | ReadonlyArray<string>
	steps?: ReadonlyArray<WorkflowStep>
	// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub workflow key
	'timeout-minutes'?: number
}

interface WorkflowConcurrency {
	group?: string
	// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub workflow key
	'cancel-in-progress'?: boolean | string
}

interface Workflow {
	concurrency?: WorkflowConcurrency
	env?: Record<string, string>
	jobs: Record<string, WorkflowJob>
}

// The template is the artifact `josh sync` distributes to consumers; the .github/ copy is
// kit's own runtime workflow and the source every action pin is resolved from.
const TEMPLATE_CI_YML = 'templates/workflows/ci.yml'
const RUNTIME_CI_YML = '.github/workflows/ci.yml'

// Resolved from the package root rather than process.cwd() so a test keeps reading the
// workflow it names no matter which directory the runner was started in.
function read_workflow(relative_path: string): string {
	return readFileSync(package_path(relative_path), 'utf8')
}

function load_workflow(relative_path: string): Workflow {
	return yaml_config_fixture.load_yaml_config(relative_path) as Workflow
}

function find_job(relative_path: string, job_name: string): WorkflowJob | undefined {
	return load_workflow(relative_path).jobs[job_name]
}

// An absent `concurrency` block reads as an empty one rather than as `undefined`, so a guard on it
// asserts on the declared values instead of having to test for the block's existence first.
function workflow_concurrency(relative_path: string): WorkflowConcurrency {
	return load_workflow(relative_path).concurrency ?? {}
}

function concurrency_cancels_in_progress(relative_path: string): boolean | string | undefined {
	return workflow_concurrency(relative_path)['cancel-in-progress']
}

// upload-artifact input keys. Shared because every guard that asserts on an artifact reaches for
// the same four, and a step is identified by the artifact name it publishes rather than by index.
const UPLOAD_NAME_INPUT = 'name'
const UPLOAD_PATH_INPUT = 'path'
const UPLOAD_MISSING_FILES_INPUT = 'if-no-files-found'
const UPLOAD_RETENTION_INPUT = 'retention-days'

function upload_input(step: WorkflowStep | undefined, key: string): string | number | undefined {
	return step?.with?.[key]
}

// Every artifact-publishing step of a job, identified by the action it runs rather than by the
// inputs it happens to set: a guard that has to hold for the whole group must derive the group
// from something a new step cannot be written without. The ref is cut off rather than matched as
// a prefix, so a step that names the action without pinning it still joins the group instead of
// dropping out of every guard built on it.
const UPLOAD_ACTION = 'actions/upload-artifact'

function action_name(step: WorkflowStep): string {
	return (step.uses ?? '').split('@', 1)[0] ?? ''
}

function upload_steps(job: WorkflowJob | undefined): ReadonlyArray<WorkflowStep> {
	return job?.steps?.filter((step) => action_name(step) === UPLOAD_ACTION) ?? []
}

function find_upload(job: WorkflowJob | undefined, artifact: string): WorkflowStep | undefined {
	return upload_steps(job).find((step) => upload_input(step, UPLOAD_NAME_INPUT) === artifact)
}

// A step is looked up by its id rather than its position or its name: the id is what the job's own
// `outputs:` expressions reference, so a guard and the workflow name the same thing, and renaming
// the step for readability cannot silently turn a guard into `undefined`. Shared because the ci.yml
// suites reach for the same two operations.
function find_step_by_id(job: WorkflowJob | undefined, step_id: string): WorkflowStep | undefined {
	return job?.steps?.find((step) => step.id === step_id)
}

// An absent step reads as an empty script, so a guard asserts on what the step runs instead of
// having to test for the step's existence first.
function step_run(step: WorkflowStep | undefined): string {
	return step?.run ?? ''
}

function job_timeout_minutes(job: WorkflowJob | undefined): number | undefined {
	return job?.['timeout-minutes']
}

// `needs` is a single name or a list; both reach a caller as a list so a guard on the dependency
// graph never has to branch on which spelling the workflow happens to use.
function job_needs(job: WorkflowJob | undefined): ReadonlyArray<string> {
	const declared = job?.needs ?? []

	return typeof declared === 'string' ? [declared] : declared
}

function step_continue_on_error(step: WorkflowStep | undefined): string | boolean | undefined {
	return step?.['continue-on-error']
}

// The e2e job and the two artifacts it publishes. Named here rather than in each guard so the two
// suites that assert on them cannot drift apart: a stale copy of a name silently turns every
// lookup into `undefined`, and the assertions built on it keep passing while testing nothing.
const E2E_JOB = 'e2e'
const LOG_PATH_VARIABLE = 'WRANGLER_LOG_PATH'
const REPORT_ARTIFACT = 'playwright-report'
const LOG_ARTIFACT = 'e2e-web-server-log'
// What the retry chain renames the first attempt's output to, and the suffix every guard on that
// output composes artifact names with. Shared for the same reason as the names above.
const ATTEMPT_SUFFIX = '-attempt-1'

function e2e_template_job(): WorkflowJob | undefined {
	return find_job(TEMPLATE_CI_YML, E2E_JOB)
}

function e2e_log_directory(job: WorkflowJob | undefined): string {
	return job?.env?.[LOG_PATH_VARIABLE] ?? ''
}

const ci_yml_fixture = {
	TEMPLATE_CI_YML,
	RUNTIME_CI_YML,
	UPLOAD_NAME_INPUT,
	UPLOAD_PATH_INPUT,
	UPLOAD_MISSING_FILES_INPUT,
	UPLOAD_RETENTION_INPUT,
	LOG_PATH_VARIABLE,
	REPORT_ARTIFACT,
	LOG_ARTIFACT,
	ATTEMPT_SUFFIX,
	read_workflow,
	load_workflow,
	find_job,
	workflow_concurrency,
	concurrency_cancels_in_progress,
	upload_input,
	upload_steps,
	find_upload,
	job_timeout_minutes,
	job_needs,
	find_step_by_id,
	step_run,
	step_continue_on_error,
	e2e_template_job,
	e2e_log_directory,
}

export { ci_yml_fixture }
export type { Workflow, WorkflowConcurrency, WorkflowJob, WorkflowStep }
