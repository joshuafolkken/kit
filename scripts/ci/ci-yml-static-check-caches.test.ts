import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#2030 and #2054: each real static-check cache must save a fresh entry on every run
// instead of freezing on the first content-hash key. The runtime gate writes all three files; the
// distributed workflow writes only eslint and cspell caches because its strict Svelte check has no
// safe persistent mode. Assert the writer beside the action so a cache of a file no command produces
// cannot pass from its key shape alone.
const SHA_SUFFIX = '-${{ github.sha }}'
const TS_BUILD_CACHE_STEP = 'tsbuildinfo-cache'
const TS_CHECK_COMMAND = 'pnpm josh check'

interface WorkflowCase {
	relative_path: string
	job_name: string
	gate_command?: string
	excluded_step_id?: string
}

interface CacheCase {
	step_id: string
	path: string
	command_fragment: string
}

const TEMPLATE_WORKFLOW_CASE: WorkflowCase = {
	relative_path: ci_yml_fixture.TEMPLATE_CI_YML,
	job_name: 'checks',
	excluded_step_id: TS_BUILD_CACHE_STEP,
}

const WORKFLOW_CASES: ReadonlyArray<WorkflowCase> = [
	{
		relative_path: ci_yml_fixture.RUNTIME_CI_YML,
		job_name: 'static-checks',
		gate_command: 'pnpm josh gate',
	},
	TEMPLATE_WORKFLOW_CASE,
]

const CACHE_CASES: ReadonlyArray<CacheCase> = [
	{
		step_id: 'eslint-cache',
		path: '.eslintcache',
		command_fragment: 'pnpm exec eslint . --cache --cache-strategy content',
	},
	{ step_id: TS_BUILD_CACHE_STEP, path: '.tsbuildinfo', command_fragment: TS_CHECK_COMMAND },
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
	describe.each(CACHE_CASES.filter(({ step_id }) => step_id !== workflow_case.excluded_step_id))(
		'cache saves fresh every run ($step_id)',
		({ step_id, path, command_fragment }) => {
			// The lookups above return the empty string for a step that is not there, which would let the two
			// assertions below pass on a job that had lost the cache entirely.
			it('caches the file its check writes at the repo root', () => {
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

describe('the distributed template caches only files its checks write', () => {
	it('does not add a second TypeScript check solely to produce a cache file', () => {
		expect(
			job_scripts(TEMPLATE_WORKFLOW_CASE).some((script) => script.includes(TS_CHECK_COMMAND)),
		).toBe(false)
	})

	it('does not configure an unwritten TypeScript build cache', () => {
		expect(cache_step(TEMPLATE_WORKFLOW_CASE, TS_BUILD_CACHE_STEP)).toBeUndefined()
	})
})
