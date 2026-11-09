import { readFile } from 'node:fs/promises'
import { yaml_document } from '#scripts/lib/yaml-document'
import { z } from 'zod'

// A job that only gathers others' results — kit's `Checks`, which `needs` the unit shards — ends
// `failure` beside a shard red on a test the change never touched, and its log names no test
// (joshuafolkken/kit#5171). It fails because of that shard alone, so it is rerun with it; the rerun
// endpoint reruns a failed job's dependents in any case. **The workflow's own `needs` says which job
// waits on which**, read from the checkout the pull request's head is.
//
// A job is known by the name a check run carries, which the workflow writes as a template: an
// expression in it matches anything, and a name with none gains the ` (<matrix values>)` suffix GitHub
// appends to a matrix job; a job calling a reusable workflow carries ` / <called job>` after it. A job
// no pattern matches — a name built otherwise — is waited on by nothing here, so its failure is kept,
// and it counts as a need the run lacks, so a job needing it is rerun once on its first attempt.

const EXPRESSION = /\$\{\{[^}]*\}\}/u
const EXPRESSION_MARK = '${{'
const ANY_TEXT = '.+'
const MATRIX_SUFFIX = String.raw`(?: \(.+\))?`
const CALLED_JOB_SUFFIX = ' / .+'
const REGEX_SPECIAL = /[$()*+.?[\\\]^{|}]/gu

const needs_schema = z.array(z.string())

const job_schema = z.looseObject({
	name: z.string().optional(),
	needs: z.union([z.string(), needs_schema]).optional(),
	uses: z.string().optional(),
})

const workflow_schema = z.looseObject({ jobs: z.record(z.string(), job_schema) })

type WorkflowJobs = z.infer<typeof workflow_schema>['jobs']

interface JobNeeds {
	pattern: RegExp
	needs: ReadonlyArray<RegExp>
}

type NeedsGraph = ReadonlyArray<JobNeeds>

function escape(text: string): string {
	return text.replaceAll(REGEX_SPECIAL, String.raw`\$&`)
}

function name_source(name: string): string {
	if (!name.includes(EXPRESSION_MARK)) return `${escape(name)}${MATRIX_SUFFIX}`

	return name
		.split(EXPRESSION)
		.map((part) => escape(part))
		.join(ANY_TEXT)
}

function needs_list(needs: string | ReadonlyArray<string> = []): ReadonlyArray<string> {
	return typeof needs === 'string' ? [needs] : needs
}

function pattern_of(jobs: WorkflowJobs, id: string): RegExp {
	const job = jobs[id]
	const suffix = job?.uses === undefined ? '' : CALLED_JOB_SUFFIX

	return new RegExp(`^${name_source(job?.name ?? id)}${suffix}$`, 'u')
}

// The jobs of a workflow, each with the names of the jobs it needs; a workflow of another shape has
// none. YAML that does not parse throws, which `read_graph` answers as none.
function parse_graph(workflow: string): NeedsGraph {
	const parsed = workflow_schema.safeParse(yaml_document.parse_yaml(workflow))

	if (!parsed.success) return []

	const { jobs } = parsed.data

	return Object.entries(jobs).map(([id, job]) => ({
		pattern: pattern_of(jobs, id),
		needs: needs_list(job.needs).map((need) => pattern_of(jobs, need)),
	}))
}

function needs_of(graph: NeedsGraph, job_name: string): ReadonlyArray<RegExp> {
	return graph.filter(({ pattern }) => pattern.test(job_name)).flatMap((job) => job.needs)
}

// **Whether the job named `job_name` needs one of the jobs named in `upstream`.**
function is_waiting_on(
	graph: NeedsGraph,
	job_name: string,
	upstream: ReadonlyArray<string>,
): boolean {
	const needs = needs_of(graph, job_name)

	return upstream.some((name) => needs.some((pattern) => pattern.test(name)))
}

// **Whether a job the job named `job_name` needs is absent from the run**, whose jobs are named in
// `run_jobs`. GitHub Actions once ran SonarQube without creating its `change-scope`, so the guard step
// reading `needs.change-scope.result` failed with nothing wrong in the change (joshuafolkken/kit#6923).
function is_missing_need(
	graph: NeedsGraph,
	job_name: string,
	run_jobs: ReadonlyArray<string>,
): boolean {
	return needs_of(graph, job_name).some((pattern) => run_jobs.every((name) => !pattern.test(name)))
}

async function read_graph(workflow_path: string): Promise<NeedsGraph> {
	try {
		return parse_graph(await readFile(workflow_path, 'utf8'))
	} catch {
		return []
	}
}

const followup_job_needs = { is_missing_need, is_waiting_on, parse_graph, read_graph }

export type { NeedsGraph }
export { followup_job_needs }
