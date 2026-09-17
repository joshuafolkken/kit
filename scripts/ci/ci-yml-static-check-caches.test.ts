import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#2030: the three static-check caches must save a fresh entry on every run so they
// track `main` rather than freezing on the first commit that hit a content-hash key and never
// re-saving. The shape that does it is a `${{ github.sha }}` tail on the key, with the sha-less
// prefix leading `restore-keys` — so the newest previous entry is restored and a new one is always
// saved. Asserted on the parsed cache step rather than the file's text, so a key that regressed
// while its comment still read correctly fails here instead of asserting the comment.
const SHA_SUFFIX = '-${{ github.sha }}'

interface WorkflowCase {
	relative_path: string
	job_name: string
	gate_command?: string
}

interface CacheCase {
	step_id: string
	path: string
	command_fragment: string
}

const WORKFLOW_CASES: ReadonlyArray<WorkflowCase> = [
	{
		relative_path: ci_yml_fixture.RUNTIME_CI_YML,
		job_name: 'static-checks',
		gate_command: 'pnpm josh gate',
	},
	{ relative_path: ci_yml_fixture.TEMPLATE_CI_YML, job_name: 'checks' },
]

const CACHE_CASES: ReadonlyArray<CacheCase> = [
	{
		step_id: 'eslint-cache',
		path: '.eslintcache',
		command_fragment: 'pnpm exec eslint . --cache --cache-strategy content',
	},
	{ step_id: 'tsbuildinfo-cache', path: '.tsbuildinfo', command_fragment: 'pnpm josh check' },
	{ step_id: 'cspell-cache', path: '.cspellcache', command_fragment: 'pnpm josh cspell:dot' },
]

function cache_step(
	workflow_case: WorkflowCase,
	step_id: string,
): ReturnType<typeof ci_yml_fixture.find_step_by_id> {
	const job = ci_yml_fixture.find_job(workflow_case.relative_path, workflow_case.job_name)

	return ci_yml_fixture.find_step_by_id(job, step_id)
}

function cache_input(workflow_case: WorkflowCase, step_id: string, key: string): string {
	return String(cache_step(workflow_case, step_id)?.with?.[key] ?? '')
}

function job_scripts(workflow_case: WorkflowCase): ReadonlyArray<string> {
	return (
		ci_yml_fixture
			.find_job(workflow_case.relative_path, workflow_case.job_name)
			?.steps?.map((step) => ci_yml_fixture.step_run(step)) ?? []
	)
}

describe.each(WORKFLOW_CASES)('static-check caches in $relative_path', (workflow_case) => {
	describe.each(CACHE_CASES)(
		'cache saves fresh every run ($step_id)',
		({ step_id, path, command_fragment }) => {
			// The lookups above return the empty string for a step that is not there, which would let the two
			// assertions below pass on a job that had lost the cache entirely.
			it('caches the file the gate writes at the repo root', () => {
				expect(cache_input(workflow_case, step_id, 'path')).toContain(path)
			})

			it('keys the cache on the commit sha so a fresh entry is saved every run', () => {
				expect(cache_input(workflow_case, step_id, 'key').endsWith(SHA_SUFFIX)).toBe(true)
			})

			it('restores the newest previous entry via the sha-less prefix', () => {
				const prefix = cache_input(workflow_case, step_id, 'key').slice(0, -SHA_SUFFIX.length)

				expect(prefix).not.toBe('')
				expect(cache_input(workflow_case, step_id, 'restore-keys')).toContain(prefix)
			})

			it('runs a command that writes the cached file', () => {
				const writer_command = workflow_case.gate_command ?? command_fragment

				expect(job_scripts(workflow_case).some((script) => script.includes(writer_command))).toBe(
					true,
				)
			})
		},
	)
})
