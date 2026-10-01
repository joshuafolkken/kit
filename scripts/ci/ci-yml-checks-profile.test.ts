import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_basic } from '#scripts/init/init-basic'
import type { ProjectShape } from '#scripts/init/project-profile'
import { canonical_command, COMMAND_MAP, type CommandEntry } from '#scripts/josh/josh-command-map'
import { afterAll, describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

// joshuafolkken/kit#2814: the distributed `checks` job ran `pnpm prepare` and `svelte-check` for every
// profile, and a basic project's manifest has neither a `prepare` script nor SvelteKit — so every
// basic consumer's first pull request went red. The job now reads the profile from `josh profile`
// and hands a basic project to `josh gate`. These guards run the profile step's own script and
// evaluate each step's `if:` with GitHub's expression engine, so they test what the runner would do.
const CHECKS_JOB = 'checks'
const PROFILE_STEP_ID = 'profile'
const BASIC_TRUE = 'is_basic=true'
const OUTPUT_FILE_NAME = 'github-output'
const EXECUTABLE_MODE = 0o755
const TSX_BIN = path.resolve('node_modules', '.bin', 'tsx')
const JOSH_INVOCATION = /\bpnpm\s+(?:--silent\s+)?josh\s+([\w:-]+)/u
// The `pnpm` sub-commands that are pnpm's own rather than a package script, plus every flag form.
const SCRIPT_INVOCATION = /\bpnpm\s+(?!exec\b|install\b|store\b|-)([\w:-]+)/gu
const SVELTE_CHECK = 'svelte-check'
const BASIC_FORBIDDEN_TOKENS: ReadonlyArray<string> = ['svelte-kit', SVELTE_CHECK, 'pnpm exec']
const NODE_REQUIRED_TOKENS: ReadonlyArray<string> = [
	'pnpm josh cspell:dot',
	'pnpm prepare',
	SVELTE_CHECK,
	'pnpm exec prettier',
	'pnpm build',
	'pnpm exec eslint',
	'pnpm josh test:unit',
	'pnpm size-limit',
]
const GATE_COMMAND = 'pnpm josh gate'
const BASIC_SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	has_web: true,
	has_typescript: false,
	has_git: true,
	has_github: true,
}
const VERSIONS = { kit: '1.0.0', prettier: '^3.0.0' }
const { TEMPLATE_CI_YML, find_job, find_step_by_id, step_run } = ci_yml_fixture

const workspace = mkdtempSync(path.join(tmpdir(), 'checks-profile-'))

afterAll(() => {
	rmSync(workspace, { recursive: true, force: true })
})

function basic_manifest(): string {
	return init_basic.merge_basic_manifest(init_basic.initial_manifest(), BASIC_SHAPE, VERSIONS)
}

function full_manifest(): string {
	return init_basic.with_recorded_profile(init_basic.initial_manifest(), 'full')
}

function checks_steps(): ReadonlyArray<WorkflowStep> {
	return find_job(TEMPLATE_CI_YML, CHECKS_JOB)?.steps ?? []
}

function profile_step_script(): string {
	return step_run(find_step_by_id(find_job(TEMPLATE_CI_YML, CHECKS_JOB), PROFILE_STEP_ID))
}

// The registry entry for the `josh` sub-command the step itself invokes, so a renamed or mistyped
// command fails here instead of in every consumer's checks job after `josh sync`.
function invoked_command(): CommandEntry | undefined {
	const name = JOSH_INVOCATION.exec(profile_step_script())?.[1]

	return name === undefined ? undefined : COMMAND_MAP[canonical_command(name)]
}

// A `pnpm` on PATH that runs the script the step's `josh` sub-command maps to, so the step's script
// runs against the real profile output rather than a string this file made up.
function write_pnpm_stub(): string {
	const bin_directory = path.join(workspace, 'bin')
	const stub_path = path.join(bin_directory, 'pnpm')
	const cli_path = path.resolve(invoked_command()?.script ?? '')

	mkdirSync(bin_directory, { recursive: true })
	writeFileSync(stub_path, `#!/bin/sh\nexec "${TSX_BIN}" "${cli_path}"\n`)
	chmodSync(stub_path, EXECUTABLE_MODE)

	return bin_directory
}

const bin_directory = write_pnpm_stub()

function run_profile_step(name: string, manifest: string): string {
	const project_directory = path.join(workspace, name)
	const output_path = path.join(project_directory, OUTPUT_FILE_NAME)
	const script = profile_step_script()

	mkdirSync(project_directory, { recursive: true })
	writeFileSync(path.join(project_directory, 'package.json'), manifest)
	writeFileSync(output_path, '')
	const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
		cwd: project_directory,
		env: {
			...process.env,
			GITHUB_OUTPUT: output_path,
			PATH: `${bin_directory}:${process.env['PATH'] ?? ''}`,
		},
		encoding: 'utf8',
	})

	expect(result.status, result.stderr).toBe(0)

	return readFileSync(output_path, 'utf8')
}

// Which steps run for a profile: a step with no `if:` always runs, and the rest are evaluated with
// the profile step's output and no Playwright to install — a basic project declares none.
function scripts_that_run(is_basic: boolean): ReadonlyArray<string> {
	const context = {
		steps: { profile: { outputs: { is_basic: String(is_basic) } } },
		needs: { 'playwright-image': { outputs: { should_install_browsers: 'false' } } },
	}

	return checks_steps()
		.filter(
			(step) =>
				step.if === undefined || workflow_expression_fixture.evaluate_condition(step.if, context),
		)
		.map((step) => step_run(step))
}

function invoked_scripts(scripts: ReadonlyArray<string>): ReadonlyArray<string> {
	return scripts.flatMap((script) =>
		[...script.matchAll(SCRIPT_INVOCATION)].map((match) => match[1] ?? ''),
	)
}

function manifest_scripts(manifest: string): ReadonlyArray<string> {
	const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> }

	return Object.keys(parsed.scripts ?? {})
}

describe('the checks job reads the profile from josh profile', () => {
	it('invokes the registered josh profile command', () => {
		expect(invoked_command()).toBe(COMMAND_MAP['profile'])
	})

	it('reports a basic manifest as basic', () => {
		expect(run_profile_step('basic', basic_manifest())).toContain(BASIC_TRUE)
	})

	it('reports a full manifest as not basic', () => {
		expect(run_profile_step('full', full_manifest())).toContain('is_basic=false')
	})
})

describe('a basic project runs only what its manifest provides', () => {
	const scripts = scripts_that_run(true)

	it.each(invoked_scripts(scripts))(
		'calls the package script %j that the manifest declares',
		(name) => {
			expect(manifest_scripts(basic_manifest())).toContain(name)
		},
	)

	it.each(BASIC_FORBIDDEN_TOKENS)('never runs %j', (token) => {
		expect(scripts.some((script) => script.includes(token))).toBe(false)
	})

	it('hands the checks to the verification gate', () => {
		expect(scripts.some((script) => script.startsWith(GATE_COMMAND))).toBe(true)
	})
})

describe('a full project keeps every check it ran before', () => {
	const scripts = scripts_that_run(false)

	it.each(NODE_REQUIRED_TOKENS)('still runs %j', (token) => {
		expect(scripts.some((script) => script.includes(token))).toBe(true)
	})

	it('does not run the gate on top of the ordered steps', () => {
		expect(scripts.some((script) => script.startsWith(GATE_COMMAND))).toBe(false)
	})
})
