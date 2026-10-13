import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { project_test_script } from './project-test-script'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const NODE_TEST = 'node --test'
const COMMAND_LABEL = 'test:unit'
const REENTRANT_ENVIRONMENT = { [project_test_script.REENTRY_KEY]: '1' }

const ctx = { project_directory: '' }

function fake_result(exit_code: number | undefined): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

function write_manifest(manifest: unknown): void {
	writeFileSync(path.join(ctx.project_directory, 'package.json'), JSON.stringify(manifest))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	ctx.project_directory = mkdtempSync(path.join(tmpdir(), 'project-test-script-'))
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(ctx.project_directory, { recursive: true, force: true })
})

describe('project_test_script.declared_script', () => {
	it('answers the test script the project declares', () => {
		write_manifest({ scripts: { test: NODE_TEST } })

		expect(project_test_script.declared_script(ctx.project_directory)).toBe(NODE_TEST)
	})

	it('answers nothing for a project without a package.json', () => {
		expect(project_test_script.declared_script(ctx.project_directory)).toBeUndefined()
	})

	it('answers nothing when the manifest carries no test script', () => {
		write_manifest({ scripts: { josh: 'josh' } })

		expect(project_test_script.declared_script(ctx.project_directory)).toBeUndefined()
	})

	// `npm init` writes a script that exits 1 by design; running it would fail every new project.
	it('treats the placeholder npm init writes as no declaration', () => {
		write_manifest({ scripts: { test: ` ${project_test_script.INIT_PLACEHOLDER} ` } })

		expect(project_test_script.declared_script(ctx.project_directory)).toBeUndefined()
	})

	it.each([[''], [' '.repeat(3)], [1], [[]]])('treats %j as no declaration', (script) => {
		write_manifest({ scripts: { test: script } })

		expect(project_test_script.declared_script(ctx.project_directory)).toBeUndefined()
	})
})

describe('project_test_script.state', () => {
	it('is declared for a project with a test script', () => {
		write_manifest({ scripts: { test: NODE_TEST } })

		expect(project_test_script.state(ctx.project_directory, {})).toBe('declared')
	})

	it('is absent for a project with no test script', () => {
		write_manifest({})

		expect(project_test_script.state(ctx.project_directory, {})).toBe('absent')
	})

	// A `scripts.test` that calls `josh test:unit` or `josh gate` reaches the check again from inside
	// the script it started; running the script from there would never return.
	it('is reentrant when the check is reached from inside the script it started', () => {
		write_manifest({ scripts: { test: 'josh test:unit' } })

		expect(project_test_script.state(ctx.project_directory, REENTRANT_ENVIRONMENT)).toBe(
			'reentrant',
		)
	})

	it('stays absent inside a running script when the project declares none', () => {
		write_manifest({})

		expect(project_test_script.state(ctx.project_directory, REENTRANT_ENVIRONMENT)).toBe('absent')
	})
})

describe('project_test_script.run', () => {
	beforeEach(() => {
		write_manifest({ scripts: { test: NODE_TEST } })
	})

	it('runs the project script through pnpm, marked so a call back into josh is recognized', async () => {
		mocked_execa.mockResolvedValue(fake_result(0))

		const exit_code = await project_test_script.run(ctx.project_directory, COMMAND_LABEL)

		expect(exit_code).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['run', 'test'],
			expect.objectContaining({ env: REENTRANT_ENVIRONMENT, stdio: 'inherit', reject: false }),
		)
	})

	it('returns the script’s failing exit code', async () => {
		const failed = 3

		mocked_execa.mockResolvedValue(fake_result(failed))

		expect(await project_test_script.run(ctx.project_directory, COMMAND_LABEL)).toBe(failed)
	})

	it('fails when the script ended without an exit code', async () => {
		mocked_execa.mockResolvedValue(fake_result(undefined))

		expect(await project_test_script.run(ctx.project_directory, COMMAND_LABEL)).not.toBe(0)
	})

	it('says which command stood in for vitest, without the skip marker', async () => {
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		mocked_execa.mockResolvedValue(fake_result(0))
		await project_test_script.run(ctx.project_directory, COMMAND_LABEL)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('pnpm run test'))
		expect(info_spy).not.toHaveBeenCalledWith(expect.stringContaining('skipping'))
	})
})
