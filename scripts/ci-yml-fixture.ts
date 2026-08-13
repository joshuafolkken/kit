import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { package_path } from './init/init-paths'

interface WorkflowStep {
	id?: string
	name?: string
	if?: string
	run?: string
	uses?: string
	with?: Record<string, string | number>
}

interface WorkflowJob {
	container?: unknown
	env?: Record<string, string>
	outputs?: Record<string, string>
	steps?: ReadonlyArray<WorkflowStep>
}

interface Workflow {
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
	return load(read_workflow(relative_path)) as Workflow
}

function find_job(relative_path: string, job_name: string): WorkflowJob | undefined {
	return load_workflow(relative_path).jobs[job_name]
}

const ci_yml_fixture = {
	TEMPLATE_CI_YML,
	RUNTIME_CI_YML,
	read_workflow,
	load_workflow,
	find_job,
}

export { ci_yml_fixture }
export type { Workflow, WorkflowJob, WorkflowStep }
