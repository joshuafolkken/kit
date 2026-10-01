import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { project_checks } from './project-checks'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { TSC_ARGS, type_check_command } = await import('./type-check-command')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const roots: Array<string> = []
const NODE_MANIFEST = '{"name":"app"}'

function fixture(manifest: string): string {
	const root = mkdtempSync(path.join(tmpdir(), 'josh-type-check-'))

	roots.push(root)
	writeFileSync(path.join(root, 'package.json'), manifest)

	return root
}

function fake_result(exit_code: number): ExecaResult {
	const result: unknown = { exitCode: exit_code }

	return result as ExecaResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.restoreAllMocks()
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('josh check on a basic project', () => {
	it('skips with the reason instead of reaching a missing tsc', async () => {
		const root = fixture('{"josh":{"profile":"static"}}')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>')

		expect(await type_check_command.run_type_check([], root)).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(info).toHaveBeenCalledWith(
			project_checks.skip_notice('check', 'no TypeScript files were found'),
		)
	})
})

describe('josh check on a full project', () => {
	it('runs tsc with the cache flags and the forwarded arguments', async () => {
		const root = fixture(NODE_MANIFEST)

		mocked_execa.mockResolvedValue(fake_result(0))

		expect(await type_check_command.run_type_check(['--pretty'], root)).toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith('pnpm', [...TSC_ARGS, '--pretty'], {
			cwd: root,
			stdio: 'inherit',
			reject: false,
		})
	})

	it('returns the type checker failure', async () => {
		mocked_execa.mockResolvedValue(fake_result(2))

		expect(await type_check_command.run_type_check([], fixture(NODE_MANIFEST))).toBe(2)
	})
})
