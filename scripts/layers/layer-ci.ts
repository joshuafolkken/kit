import { readdirSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_SCOPE, type LayerStep } from './layer-step'
import { layer_yaml } from './layer-yaml'

// What CI runs, read from the workflow definitions (joshuafolkken/kit#1313).
//
// **Only the workflows a pull request triggers count as a layer.** A `push`-only workflow runs
// after the merge, so its cost is not part of what a run waits for and a check it repeats is not
// the repetition this command is looking for. `pull_request` is the test, read from each
// workflow's own `on:` block rather than from a list of file names.
//
// **Every job of every such workflow is read, not just the one called `checks`.** kit's spell
// check and unit suite sit in one job and its dependency audit in another, and a second workflow
// adds the static analysis — one layer, three jobs, which is exactly what a name-based reader
// would have missed.

const WORKFLOW_DIRECTORY = '.github/workflows'
const CI_LAYER = 'ci'
const JOBS_KEY = 'jobs'
const STEPS_KEY = 'steps'
const ON_KEY = 'on'
// YAML 1.1 readers fold the bare key `on` into the boolean `true`. js-yaml 5 does not, but a
// document written for a reader that does is still valid input here, so both spellings are looked
// at rather than one being assumed.
const ON_KEY_AS_BOOLEAN = 'true'
const PULL_REQUEST_TRIGGER = 'pull_request'
const RUN_KEY = 'run'
const USES_KEY = 'uses'
const NAME_KEY = 'name'
const WORKFLOW_SUFFIXES = ['.yml', '.yaml']

function trigger_names(document: Record<string, unknown>): ReadonlyArray<string> {
	const triggers = document[ON_KEY] ?? document[ON_KEY_AS_BOOLEAN]
	const mapping = layer_yaml.as_record(triggers)

	if (mapping !== undefined) return Object.keys(mapping)

	return layer_yaml.string_list(triggers)
}

function is_pull_request_workflow(document: Record<string, unknown>): boolean {
	return trigger_names(document).includes(PULL_REQUEST_TRIGGER)
}

// A step's command is its `uses` and its `run` together: an action is as much a check as a shell
// line, and the audit and the static analysis are both actions.
function step_command(step: Record<string, unknown>): string {
	return [layer_yaml.as_string(step[USES_KEY]), layer_yaml.as_string(step[RUN_KEY])]
		.filter((part): part is string => part !== undefined)
		.join(' ')
}

function step_of(prefix: string, index: number, value: unknown): LayerStep | undefined {
	const step = layer_yaml.as_record(value)
	if (step === undefined) return undefined

	const command = step_command(step)
	if (command.length === 0) return undefined

	const name = layer_yaml.as_string(step[NAME_KEY]) ?? `step ${String(index)}`

	return { layer: CI_LAYER, step: `${prefix}/${name}`, command, scope: PROJECT_SCOPE }
}

function job_steps(prefix: string, job: unknown): Array<LayerStep> {
	const steps = layer_yaml.as_array(layer_yaml.as_record(job)?.[STEPS_KEY]) ?? []

	return steps
		.map((value, index) => step_of(prefix, index, value))
		.filter((step): step is LayerStep => step !== undefined)
}

// One workflow document's steps, labelled `<workflow>/<job>/<step>` so a row of the report names
// where to go and edit it.
function ci_steps_from_yaml(workflow: string, content: string): Array<LayerStep> {
	const document = layer_yaml.parse_document(content)
	if (document === undefined || !is_pull_request_workflow(document)) return []

	return layer_yaml
		.record_entries(document, JOBS_KEY)
		.flatMap(([job, value]) => job_steps(`${workflow}/${job}`, value))
}

// `withFileTypes`, so a *directory* named `something.yml` is not handed to the reader below as if
// it were a workflow. The guard is `!isDirectory()` rather than `isFile()`, which would also drop a
// symlinked workflow — a real file, reached through a name.
function workflow_files(root: string): Array<string> {
	try {
		return readdirSync(path.join(root, WORKFLOW_DIRECTORY), { withFileTypes: true })
			.filter((entry) => !entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => WORKFLOW_SUFFIXES.some((suffix) => name.endsWith(suffix)))
	} catch {
		return []
	}
}

// A file that cannot be read contributes nothing rather than stopping the walk — the same answer
// the lefthook reader gives, through the same `read_text`.
function workflow_steps(root: string, name: string): Array<LayerStep> {
	const content = layer_yaml.read_text(path.join(root, WORKFLOW_DIRECTORY, name))
	if (content === undefined) return []

	return ci_steps_from_yaml(name, content)
}

function read_ci_steps(root: string): Array<LayerStep> {
	return workflow_files(root)
		.toSorted((left, right) => left.localeCompare(right))
		.flatMap((name) => workflow_steps(root, name))
}

const layer_ci = { CI_LAYER, WORKFLOW_DIRECTORY, ci_steps_from_yaml, read_ci_steps }

export { layer_ci }
