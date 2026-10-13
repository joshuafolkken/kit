import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { project_test_script } from './project-test-script'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#3723: a basic project without vitest runs the test script it declares, so a
// `node --test` suite is no longer passed by a unit check that executed nothing.

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const PACKAGE_JSON = 'package.json'
const NODE_TEST = 'node --test'
const BASIC = { profile: 'basic' }
const RUN_SCRIPT = 'run-project-script'
const NO_SCRIPT = 'skip-no-test-script'
const MISSING_PACKAGE = 'skip-missing-package'
const VITEST_SUBJECT = 'skipping vitest unit tests'

const ctx = { project_directory: '' }

function fake_result(exit_code: number): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

function write_manifest(manifest: unknown): void {
	writeFileSync(path.join(ctx.project_directory, PACKAGE_JSON), JSON.stringify(manifest))
}

function add_vitest_package(): void {
	const package_directory = path.join(ctx.project_directory, 'node_modules', 'vitest')

	mkdirSync(package_directory, { recursive: true })
	writeFileSync(path.join(package_directory, PACKAGE_JSON), '{}')
}

function info_lines(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubEnv(project_test_script.REENTRY_KEY, '')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	ctx.project_directory = mkdtempSync(path.join(tmpdir(), 'unit-guard-script-'))
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	rmSync(ctx.project_directory, { recursive: true, force: true })
})

describe('test_unit_guard.resolve_guard_action — a basic project without vitest', () => {
	it('runs the declared test script', () => {
		expect(test_unit_guard.resolve_guard_action(false, false, true, 'declared')).toBe(RUN_SCRIPT)
	})

	it('skips, naming the missing script, when none is declared', () => {
		expect(test_unit_guard.resolve_guard_action(false, false, true, 'absent')).toBe(NO_SCRIPT)
	})

	it('skips rather than recursing when the script called back into the check', () => {
		expect(test_unit_guard.resolve_guard_action(false, false, true, 'reentrant')).toBe(
			'skip-reentrant',
		)
	})

	it('leaves a full project on the plain skip whatever its test script', () => {
		expect(test_unit_guard.resolve_guard_action(false, true, false, 'declared')).toBe(
			MISSING_PACKAGE,
		)
	})

	it('leaves an installed vitest in charge whatever the test script', () => {
		expect(test_unit_guard.resolve_guard_action(true, true, true, 'declared')).toBe('run')
		expect(test_unit_guard.resolve_guard_action(true, false, true, 'declared')).toBe(
			'skip-no-tests',
		)
	})
})

describe('test_unit_guard — a basic project that declares a test script', () => {
	beforeEach(() => {
		write_manifest({ josh: BASIC, scripts: { test: NODE_TEST } })
	})

	it('runs the script as the unit check', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith('pnpm', ['run', 'test'], expect.anything())
	})

	it('fails the unit check when the script fails', async () => {
		mocked_execa.mockResolvedValue(fake_result(1))

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).toBe(1)
	})

	// The announcement describes a vitest narrowing, which the project's whole script is not.
	it('runs the same script for the scoped command, without its vitest announcement', async () => {
		const write_spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		mocked_execa.mockResolvedValue(fake_result(0))
		await test_unit_guard.run_guarded_vitest(
			ctx.project_directory,
			['related', 'a.ts', '--run'],
			'test:related',
			'narrowed to 1 file',
		)

		expect(mocked_execa).toHaveBeenCalledWith('pnpm', ['run', 'test'], expect.anything())
		expect(write_spy).not.toHaveBeenCalled()
	})

	// The gate requires a scoped record wherever the guard is not skipping, so the two must flip
	// together or the record is demanded from a project that can never write it.
	it('counts as a run, not a skip', () => {
		expect(test_unit_guard.is_running(ctx.project_directory)).toBe(true)
		expect(test_unit_guard.is_skipping(ctx.project_directory)).toBe(false)
	})
})

describe('test_unit_guard — a test script that calls back into josh', () => {
	it('skips, saying why, when reached from inside the script it started', async () => {
		write_manifest({ josh: BASIC, scripts: { test: 'josh test:unit' } })
		vi.stubEnv(project_test_script.REENTRY_KEY, '1')

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_lines()).toContain('called back into this check')
		expect(info_lines()).toContain(test_unit_guard.SKIP_MARKER)
	})
})

describe('test_unit_guard — a basic project that declares no test script', () => {
	it.each([
		['no scripts at all', { josh: BASIC }],
		[
			'the npm init placeholder',
			{ josh: BASIC, scripts: { test: project_test_script.INIT_PLACEHOLDER } },
		],
	])('skips with a reason that names the missing script: %s', async (_name, manifest) => {
		write_manifest(manifest)

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_lines()).toContain('declares no test script')
		expect(info_lines()).toContain(test_unit_guard.SKIP_MARKER)
		expect(info_lines()).not.toContain(VITEST_SUBJECT)
		expect(test_unit_guard.is_skipping(ctx.project_directory)).toBe(true)
	})
})

describe('test_unit_guard — a project that is not basic', () => {
	it('keeps the vitest skip and never runs the test script it declares', async () => {
		write_manifest({ scripts: { test: NODE_TEST } })

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info_lines()).toContain(`vitest is not installed — ${VITEST_SUBJECT}.`)
		expect(test_unit_guard.guard_action(ctx.project_directory)).toBe(MISSING_PACKAGE)
	})

	it('keeps failing an installed vitest that found no test file', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		add_vitest_package()
		write_manifest({ scripts: { test: NODE_TEST } })

		expect(await test_unit_guard.run_guarded_unit(ctx.project_directory, [])).not.toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})
