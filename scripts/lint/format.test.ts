import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { format } = await import('./format')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const PRETTIER_FAILURE_EXIT_CODE = 2
const roots: Array<string> = []

// execa's resolved Result is a large interface; the command only reads `exitCode`.
function fake_result(exit_code: number): ExecaResult {
	return { exitCode: exit_code } as unknown as ExecaResult
}

type ProjectFiles = ReadonlyArray<readonly [string, string]>

const WEB_FILES: ProjectFiles = [
	['index.html', '<h1>Hello</h1>'],
	['site.js', 'console.log(1)\n'],
]
const PYTHON_FILES: ProjectFiles = [['main.py', 'print(1)\n']]

function write_project(manifest: Record<string, unknown>, files: ProjectFiles = WEB_FILES): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-format-'))

	roots.push(root)
	writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
	for (const [name, content] of files) writeFileSync(path.join(root, name), content)

	return root
}

function install_prettier(root: string): void {
	const bin_directory = path.join(root, 'node_modules', '.bin')

	mkdirSync(bin_directory, { recursive: true })
	writeFileSync(path.join(bin_directory, 'prettier'), '')
}

function invoked_tools(): Array<unknown> {
	return mocked_execa.mock.calls.map((call) => (call[1] as ReadonlyArray<string>)[1])
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockResolvedValue(fake_result(0))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('josh format', () => {
	it('skips ESLint with a reason and exits 0 on a static project without it', async () => {
		const root = write_project({ josh: { profile: 'static' } })

		install_prettier(root)
		expect(await format.run_format(root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier'])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('josh eslint:'))
	})

	it('runs prettier and then eslint --fix on a node project', async () => {
		const root = write_project({ josh: { profile: 'node' } })

		expect(await format.run_format(root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier', 'eslint'])
	})

	it('stops at a prettier failure without running eslint', async () => {
		const root = write_project({ josh: { profile: 'node' } })

		mocked_execa.mockResolvedValueOnce(fake_result(PRETTIER_FAILURE_EXIT_CODE))

		expect(await format.run_format(root)).toBe(PRETTIER_FAILURE_EXIT_CODE)
		expect(invoked_tools()).toEqual(['prettier'])
	})

	it('refuses extra arguments instead of formatting the whole tree', async () => {
		const root = write_project({ josh: { profile: 'node' } })
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await format.run(['src/app.ts'], root)).toBe(1)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('takes no extra arguments'))
	})

	it('formats when no extra argument is given', async () => {
		const root = write_project({ josh: { profile: 'node' } })

		expect(await format.run([], root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier', 'eslint'])
	})
})

describe('josh format without Web files', () => {
	it('skips Prettier with a reason and exits 0 on a static Python project', async () => {
		const root = write_project({ josh: { profile: 'static' } }, PYTHON_FILES)

		expect(await format.run_format(root)).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('josh prettier: no HTML, CSS or JavaScript files were found'),
		)
	})
})
