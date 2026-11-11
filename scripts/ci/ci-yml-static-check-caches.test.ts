import { gate_labels } from '#scripts/gate/gate-labels'
import { gate_static_group } from '#scripts/gate/gate-static-group'
import { lint_shard } from '#scripts/lint/lint-shard'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#2030 and #2054: each real static-check cache must save a fresh entry on every run
// instead of freezing on the first content-hash key. The runtime gate writes all three files; the
// distributed workflow writes only eslint and cspell caches because its strict Svelte check has no
// safe persistent mode. Assert the writer beside the action so a cache of a file no command produces
// cannot pass from its key shape alone.
// joshuafolkken/kit#5116: the runtime gate's `josh lint --changed` writes `.prettiercache` too; the
// distributed workflow runs `prettier --check .` with no cache flag, so it writes none to restore.
const SHA_SUFFIX = '-${{ github.sha }}'
const TS_BUILD_CACHE_STEP = 'tsbuildinfo-cache'
const PRETTIER_CACHE_STEP = 'prettier-cache'
const ESLINT_CACHE_STEP = 'eslint-cache'
const CSPELL_CACHE_STEP = 'cspell-cache'
const TS_CHECK_COMMAND = 'pnpm josh check'

interface WorkflowCase {
	relative_path: string
	job_name: string
	gate_command?: string
	excluded_step_ids?: ReadonlyArray<string>
}

interface CacheCase {
	step_id: string
	path: string
	command_fragment: string
}

const TEMPLATE_WORKFLOW_CASE: WorkflowCase = {
	relative_path: ci_yml_fixture.TEMPLATE_CI_YML,
	job_name: 'checks',
	excluded_step_ids: [TS_BUILD_CACHE_STEP, PRETTIER_CACHE_STEP],
}

const RUNTIME_WORKFLOW_CASE: WorkflowCase = {
	relative_path: ci_yml_fixture.RUNTIME_CI_YML,
	job_name: 'static-checks',
	gate_command: 'pnpm josh gate',
}

const WORKFLOW_CASES: ReadonlyArray<WorkflowCase> = [RUNTIME_WORKFLOW_CASE, TEMPLATE_WORKFLOW_CASE]

const CACHE_CASES: ReadonlyArray<CacheCase> = [
	{
		step_id: ESLINT_CACHE_STEP,
		path: '.eslintcache',
		command_fragment: 'pnpm exec eslint . --cache --cache-strategy content',
	},
	{ step_id: TS_BUILD_CACHE_STEP, path: '.tsbuildinfo', command_fragment: TS_CHECK_COMMAND },
	{ step_id: CSPELL_CACHE_STEP, path: '.cspellcache', command_fragment: 'pnpm josh cspell:dot' },
	{ step_id: PRETTIER_CACHE_STEP, path: '.prettiercache', command_fragment: 'pnpm josh lint' },
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
	describe.each(
		CACHE_CASES.filter(({ step_id }) => !workflow_case.excluded_step_ids?.includes(step_id)),
	)('cache saves fresh every run ($step_id)', ({ step_id, path, command_fragment }) => {
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
	})
})

// joshuafolkken/kit#5215: the runtime job is a matrix of static groups, and a leg that restored a cache
// its checks never write would save it back unchanged under the same sha key, racing the leg that
// writes it. So each cache restores only on the legs whose group holds the check that writes the file.
// joshuafolkken/kit#7108: the lint check runs on two shard legs, and only the formatting shard writes
// `.prettiercache`, so a step's `if` is read for the legs it holds on rather than matched as text.
const GROUP_NAMES = Object.keys(gate_static_group.STATIC_GROUPS)
const GROUP_CONDITION =
	/^(?:matrix\.group == '(?<name>[^']+)'|startsWith\(matrix\.group, '(?<prefix>[^']+)'\))$/u
const FIRST_LINT_LEG = "matrix.group == 'lint-1'"
const ANY_LINT_LEG = "startsWith(matrix.group, 'lint-')"

function groups_holding(label: string): ReadonlyArray<string> {
	return GROUP_NAMES.filter((group) => gate_static_group.STATIC_GROUPS[group]?.includes(label))
}

function formatting_groups(): ReadonlyArray<string> {
	return groups_holding(gate_labels.LINT_LABEL).filter((group) =>
		lint_shard.checks_formatting(gate_static_group.LINT_SHARD_GROUPS[group]),
	)
}

function holds_on(condition: string, group: string): boolean {
	const { name, prefix } = GROUP_CONDITION.exec(condition)?.groups ?? {}

	if (name !== undefined) return group === name

	return prefix !== undefined && group.startsWith(prefix)
}

const RUNTIME_CACHE_WRITERS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	[ESLINT_CACHE_STEP, groups_holding(gate_labels.LINT_LABEL)],
	[PRETTIER_CACHE_STEP, formatting_groups()],
	[TS_BUILD_CACHE_STEP, groups_holding(gate_labels.TYPE_CHECK_LABEL)],
	[CSPELL_CACHE_STEP, groups_holding(gate_labels.SPELL_CHECK_LABEL)],
]

describe.each(RUNTIME_CACHE_WRITERS)('the runtime %s', (step_id, writer_groups) => {
	it('restores only on the matrix legs that write it', () => {
		const condition = cache_step(RUNTIME_WORKFLOW_CASE, step_id)?.if ?? ''

		expect(writer_groups).not.toEqual([])
		expect(GROUP_NAMES.filter((group) => holds_on(condition, group))).toEqual(writer_groups)
	})
})

describe('holds_on', () => {
	it.each([
		[FIRST_LINT_LEG, 'lint-1', true],
		[FIRST_LINT_LEG, 'lint-2', false],
		[ANY_LINT_LEG, 'lint-2', true],
		[ANY_LINT_LEG, 'types', false],
		['always()', 'types', false],
	])('reads %j on the %j leg as %j', (condition, group, expected) => {
		expect(holds_on(condition, group)).toBe(expected)
	})
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

	it('does not configure an unwritten prettier cache', () => {
		expect(cache_step(TEMPLATE_WORKFLOW_CASE, PRETTIER_CACHE_STEP)).toBeUndefined()
	})
})
