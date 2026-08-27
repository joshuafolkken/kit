import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { test_e2e_guard } from './test-e2e-guard'

// Which suite CI runs and which suite `pnpm josh test:e2e` runs used to be two different questions.
// CI asked for a file named `playwright.config.ts` plus an `*.e2e.{ts,js}` under `tests` or
// `src/routes`; the guard asked for any `*.e2e.{ts,js}` outside `node_modules` and never looked at
// the config's name. A project that answered one and not the other got `enabled=false`, a skipped
// `e2e` job, a rollup that counts a skip as a pass, and a merge with the suite never run — which is
// only a defect at all because joshuafolkken/kit#902 made the CI job the sole E2E signal a `fullrun`
// reads (joshuafolkken/kit#991).
//
// These guards execute the workflow's own script rather than matching substrings in it, because a
// substring match cannot tell whether two detection rules select the same files. Each fixture is
// run twice — once through `bash` in a temporary project, once through the guard's own
// `has_e2e_tests` — and the two verdicts have to agree.
const DETECT_JOB = 'e2e-detect'
const DETECT_STEP_ID = 'check'
const OUTPUT_FILE_NAME = 'github-output'
const ENABLED_TRUE = 'enabled=true'
const PLAYWRIGHT_PACKAGE = path.join('node_modules', '@playwright', 'test')
// The two paths most rows share: the config spelling CI used to demand, and a spec in the one
// directory it used to search. Named so a row differs from the others only where it means to.
const TS_CONFIG = 'playwright.config.ts'
const ROUTE_SPEC = 'src/routes/home.e2e.ts'
const { TEMPLATE_CI_YML, RUNTIME_CI_YML, find_job, find_step_by_id, step_run } = ci_yml_fixture

const workspace = mkdtempSync(path.join(tmpdir(), 'e2e-detect-'))

afterAll(() => {
	rmSync(workspace, { recursive: true, force: true })
})

function detect_script(relative_path: string): string {
	return step_run(find_step_by_id(find_job(relative_path, DETECT_JOB), DETECT_STEP_ID))
}

const template_script = detect_script(TEMPLATE_CI_YML)

function write_file(project_directory: string, relative_path: string): void {
	const absolute = path.join(project_directory, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '')
}

// A throwaway project containing exactly the named files, so a case describes a repository layout
// rather than a sequence of filesystem calls. The directory name is sanitized because the layouts
// read as sentences and some of them name paths: joined verbatim, `a spec under src` would become
// a parent directory of `a spec under src/routes`, and the outer project's walk would find the
// inner project's specs — a false green in the guard written to prevent false greens.
function make_project(name: string, files: ReadonlyArray<string>): string {
	const project_directory = path.join(workspace, name.replaceAll(/[^a-z0-9]+/giu, '-'))

	mkdirSync(project_directory, { recursive: true })
	for (const file of files) write_file(project_directory, file)

	return project_directory
}

// Both shells a runner can pick, because they are not equivalent and the difference is a whole
// answer. GitHub runs a `run:` block under `bash -e` by default and under `bash -eo pipefail` once
// the step declares `shell: bash` or a `defaults: run: shell: bash` block does it for every step,
// and a detection written around a pipe answers the two
// differently — the first ignores a `find` killed by the closed pipe, the second reads it as the
// verdict.
// Running one shell would leave the script one workflow edit away from reporting "no E2E" for
// every project, with every row here still green.
const RUNNER_SHELLS: ReadonlyArray<ReadonlyArray<string>> = [['-e'], ['-e', '-o', 'pipefail']]

function run_in_shell(
	flags: ReadonlyArray<string>,
	script: string,
	project_directory: string,
): boolean {
	const output_path = path.join(project_directory, OUTPUT_FILE_NAME)

	writeFileSync(output_path, '')
	const result = spawnSync('bash', [...flags, '-c', script], {
		cwd: project_directory,
		env: { ...process.env, GITHUB_OUTPUT: output_path },
		encoding: 'utf8',
	})

	expect(result.status, result.stderr).toBe(0)

	return readFileSync(output_path, 'utf8').includes(ENABLED_TRUE)
}

function run_detection(script: string, project_directory: string): boolean {
	const verdicts = RUNNER_SHELLS.map((flags) => run_in_shell(flags, script, project_directory))

	expect(new Set(verdicts).size, 'the runner shells disagree about this project').toBe(1)

	return verdicts[0] === true
}

interface DetectionCase {
	readonly layout: string
	readonly files: ReadonlyArray<string>
	readonly has_specs: boolean
}

// Every row is a layout the two rules used to disagree about, or one they have to keep agreeing
// about. `has_specs` is asserted as well as compared: two rules that were both wrong would agree
// with each other and say nothing.
const DETECTION_CASES: ReadonlyArray<DetectionCase> = [
	{
		layout: 'a spec under src/routes',
		files: [TS_CONFIG, ROUTE_SPEC],
		has_specs: true,
	},
	{
		layout: 'a spec under tests',
		files: [TS_CONFIG, 'tests/smoke.e2e.ts'],
		has_specs: true,
	},
	{
		layout: 'a spec outside both paths CI used to search',
		files: [TS_CONFIG, 'src/lib/widget.e2e.ts'],
		has_specs: true,
	},
	{
		layout: 'a JavaScript Playwright config beside a spec',
		files: ['playwright.config.js', ROUTE_SPEC],
		has_specs: true,
	},
	{
		layout: 'a spec with no Playwright config at all',
		files: [ROUTE_SPEC],
		has_specs: true,
	},
	{
		layout: 'a compiled .e2e.js spec',
		files: [TS_CONFIG, 'src/routes/home.e2e.js'],
		has_specs: true,
	},
	{
		layout: 'no spec anywhere',
		files: [TS_CONFIG, 'src/routes/home.test.ts'],
		has_specs: false,
	},
	{
		layout: 'specs only inside node_modules',
		files: [TS_CONFIG, 'node_modules/some-package/vendored.e2e.ts'],
		has_specs: false,
	},
	{
		layout: 'specs only inside a nested node_modules',
		files: [TS_CONFIG, 'packages/app/node_modules/dep/vendored.e2e.ts'],
		has_specs: false,
	},
	{
		layout: 'specs only inside a dot directory',
		files: [TS_CONFIG, '.cache/leftover.e2e.ts'],
		has_specs: false,
	},
]

describe('e2e-detect selects the same specs as the local guard', () => {
	// This row is the acceptance condition of joshuafolkken/kit#991 as well as an equivalence check.
	// A layout CI reads as "no E2E" while specs sit in it is what let a merge through with the suite
	// never run, and the two assertions rule one out for every layout in the matrix: the guard's
	// verdict is the layout's declared one, and CI's verdict is the guard's.
	it.each(DETECTION_CASES)('agrees on $layout', (detection_case) => {
		const project_directory = make_project(detection_case.layout, detection_case.files)
		const has_guard_specs = test_e2e_guard.has_e2e_tests(project_directory)

		expect(has_guard_specs).toBe(detection_case.has_specs)
		expect(run_detection(template_script, project_directory)).toBe(has_guard_specs)
	})

	// A structural guard against the narrowing coming back by a different route: the rule that broke
	// was a filename test, and re-adding one would restore the defect while every row above still
	// passed on a project whose config happens to be named `playwright.config.ts`.
	it('does not consult the config filename', () => {
		expect(template_script).not.toContain('playwright.config')
	})

	// kit's own pull requests run the .github copy, so a fix that landed only in the distributed
	// template would leave this repository merging on the signal it just declared untrustworthy.
	it('applies the same script in the runtime workflow', () => {
		expect(detect_script(RUNTIME_CI_YML)).toBe(template_script)
	})
})

// The one place the two rules are meant to differ, kept explicit so it reads as a decision rather
// than as the drift this file exists to remove. The guard skips when `@playwright/test` is not
// installed, which is what keeps that optional peer optional for the pre-push hook; CI enables the
// job on the spec alone, so a spec that cannot run ends red instead of silently green. The
// direction matters: enabling more than the guard costs a failed job, enabling less costs a merge.
describe('the remaining difference from the guard is one-sided', () => {
	it.each([
		{ installed: true, action: 'run' },
		{ installed: false, action: 'skip-missing-package' },
	])('enables the job on the spec alone while the guard answers $action', (state) => {
		const files = [ROUTE_SPEC]
		const project_directory = make_project(
			`one-sided-${String(state.installed)}`,
			state.installed ? [...files, path.join(PLAYWRIGHT_PACKAGE, 'package.json')] : files,
		)
		const action = test_e2e_guard.resolve_guard_action(
			test_e2e_guard.is_playwright_installed(project_directory),
			test_e2e_guard.has_e2e_tests(project_directory),
		)

		expect(action).toBe(state.action)
		expect(run_detection(template_script, project_directory)).toBe(true)
	})
})
