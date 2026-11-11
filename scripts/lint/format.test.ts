import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { ESLINT_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { fake_result } from '#tools/test/execa-result'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_heap } from './eslint-heap'

vi.mock('execa', () => ({ execa: vi.fn() }))

const { format } = await import('./format')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const PRETTIER_FAILURE_EXIT_CODE = 2
const make_directory = temporary_directory()

type ProjectFiles = ReadonlyArray<readonly [string, string]>

const WEB_FILES: ProjectFiles = [
	['index.html', '<h1>Hello</h1>'],
	['site.js', 'console.log(1)\n'],
]
const PYTHON_FILES: ProjectFiles = [['main.py', 'print(1)\n']]

function write_project(manifest: Record<string, unknown>, files: ProjectFiles = WEB_FILES): string {
	const root = make_directory('josh-format-')

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
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('josh format heap', () => {
	it.each([undefined, '--trace-warnings', '--max_old_space_size=4096'])(
		'passes the shared heap only to ESLint with options %s (ac-c8c6f65c)',
		async (options) => {
			vi.stubEnv('NODE_OPTIONS', options)
			const environment = { NODE_OPTIONS: eslint_heap.with_heap(options) }

			vi.spyOn(eslint_heap, 'environment').mockReturnValue(environment)
			const root = write_project({ josh: { profile: 'full' } })

			await format.run_format(root)
			expect(mocked_execa).toHaveBeenNthCalledWith(1, 'pnpm', expect.any(Array), {
				cwd: root,
				stdio: 'inherit',
				reject: false,
			})
			expect(mocked_execa).toHaveBeenNthCalledWith(
				2,
				'pnpm',
				expect.any(Array),
				expect.objectContaining({ env: environment, extendEnv: false }),
			)
		},
	)
})

describe('josh format', () => {
	it('skips ESLint with a reason and exits 0 on a basic project without it', async () => {
		const root = write_project({ josh: { profile: 'basic' } })

		install_prettier(root)
		expect(await format.run_format(root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier'])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('josh eslint:'))
	})

	it('runs prettier and then eslint --fix on a full project', async () => {
		const root = write_project({ josh: { profile: 'full' } })

		expect(await format.run_format(root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier', 'eslint'])
	})

	it('stops at a prettier failure without running eslint', async () => {
		const root = write_project({ josh: { profile: 'full' } })

		mocked_execa.mockResolvedValueOnce(fake_result(PRETTIER_FAILURE_EXIT_CODE))

		expect(await format.run_format(root)).toBe(PRETTIER_FAILURE_EXIT_CODE)
		expect(invoked_tools()).toEqual(['prettier'])
	})

	it('refuses extra arguments instead of formatting the whole tree', async () => {
		const root = write_project({ josh: { profile: 'full' } })
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await format.run(['src/app.ts'], root)).toBe(1)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining('takes no extra arguments'))
	})

	it('formats when no extra argument is given', async () => {
		const root = write_project({ josh: { profile: 'full' } })

		expect(await format.run([], root)).toBe(0)
		expect(invoked_tools()).toEqual(['prettier', 'eslint'])
	})
})

describe('josh format targets', () => {
	it('writes only the Web files of a basic project under the default josh.format', async () => {
		const root = write_project({ josh: { profile: 'basic' } })

		install_prettier(root)
		await format.run_format(root)
		expect(mocked_execa.mock.calls[0]?.[1]).toContain(project_checks.WEB_FILES)
		expect(mocked_execa.mock.calls[0]?.[1]).not.toContain('.')
	})
})

describe('josh format without Web files', () => {
	it('skips Prettier with a reason and exits 0 on a basic Python project', async () => {
		const root = write_project({ josh: { profile: 'basic' } }, PYTHON_FILES)

		expect(await format.run_format(root)).toBe(0)
		expect(mocked_execa).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('josh prettier: no HTML, CSS or JavaScript files were found'),
		)
	})
})

// joshuafolkken/kit#4415: `eslint --fix` writes the gate's cache file, so it is guarded as the gate's
// lint is — entries whose imports changed are dropped before it reads them.
describe('josh format — the dependency guard', () => {
	it('runs eslint --fix inside the guard of the gate cache file', async () => {
		const root = write_project({ josh: { profile: 'full' } })
		const guard = vi.spyOn(eslint_cache_dependencies, 'guard')

		expect(await format.run_format(root)).toBe(0)
		expect(guard).toHaveBeenCalledWith(ESLINT_CACHE_FILE, expect.any(Function), root)
	})
})
