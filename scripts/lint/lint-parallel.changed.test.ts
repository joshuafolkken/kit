import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { ESLINT_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { fake_result } from '#tools/test/execa-result'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESLINT_HEAP_MIB } from './eslint-heap'
import { lint_parallel } from './lint-parallel'

// joshuafolkken/kit#4085: `josh lint --changed` is the gate's lint. Narrowed, it must still hand the
// changed files to both linters and fail on what they report; it must never narrow in CI.

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('#scripts/lane/lane-cache-run', () => ({
	lane_cache_run: {
		run: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => await work()),
	},
}))
vi.mock('./eslint-cache-dependencies', () => ({
	eslint_cache_dependencies: {
		guard_counted: vi.fn(async (_cache_file: string, work: () => Promise<unknown>) => ({
			result: await work(),
		})),
	},
}))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const ROOT = process.cwd()
const CHANGED = path.join('scripts', 'lint', 'lint-parallel.ts')
const ABSOLUTE_CHANGED = path.join(ROOT, CHANGED)
const WHOLE_TREE = '.'
const FAILED = 1
const CHANGED_ARGUMENTS = ['--changed']
const PRETTIER_PASS = 'All matched files use Prettier code style!'
const TIMING_LINE =
	/^lint timing — prettier \d+\.\d s · eslint \d+\.\d s · cache (?:present|absent)/u
const ESLINT_HEAP = `--max-old-space-size=${String(ESLINT_HEAP_MIB)}`
const COLD_OPTIONS = `${ESLINT_HEAP} --import=${new URL('eslint-memory.js', import.meta.url).href}`

function mock_exit_codes(prettier_code: number, eslint_code: number): void {
	mocked_execa
		.mockResolvedValueOnce(fake_result(prettier_code))
		.mockResolvedValueOnce(fake_result(eslint_code))
}

function linter_arguments(): ReadonlyArray<ReadonlyArray<string>> {
	return mocked_execa.mock.calls.map((call) => (Array.isArray(call[1]) ? call[1] : []))
}

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.stubEnv('CI', '')
	vi.mocked(git_command.repository_root).mockResolvedValue(ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED])
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('lint_parallel.run_lint_command --changed', () => {
	it('hands both linters the changed file rather than the whole tree', async () => {
		mock_exit_codes(0, 0)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(0)

		for (const argv of linter_arguments()) {
			expect(argv).toContain(ABSOLUTE_CHANGED)
			expect(argv).not.toContain(WHOLE_TREE)
		}
	})

	it('fails on a violation eslint reports in the changed file', async () => {
		mock_exit_codes(0, FAILED)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
	})

	it('fails on a formatting violation prettier reports in the changed file', async () => {
		mock_exit_codes(FAILED, 0)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
	})

	it('lints the whole tree in CI', async () => {
		vi.stubEnv('CI', 'true')
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})

	it('lints the whole tree when a configuration file changed', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED, 'eslint.config.js'])
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})

	it('lints the whole tree without the flag', async () => {
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command([])

		for (const argv of linter_arguments()) expect(argv).toContain(WHOLE_TREE)
	})
})

// joshuafolkken/kit#6997: CI's sharded gate lint reaches eslint with the shard's targets, and its
// scope line names the shard.
describe('lint_parallel.run_lint_command --changed --shard in CI', () => {
	it('lints shard 1 directories and the whole tree’s formatting', async () => {
		vi.stubEnv('CI', 'true')
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command([...CHANGED_ARGUMENTS, '--shard=1'])

		expect(linter_arguments()[1]).toContain('scripts/run')
		expect(linter_arguments()[1]).not.toContain(WHOLE_TREE)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining(' · shard 1 of 2\n'))
	})

	it('lints shard 2 with eslint alone, ignoring shard 1 directories', async () => {
		vi.stubEnv('CI', 'true')
		mocked_execa.mockResolvedValueOnce(fake_result(0))

		await expect(lint_parallel.run_lint_command([...CHANGED_ARGUMENTS, '--shard=2'])).resolves.toBe(
			0,
		)

		expect(mocked_execa).toHaveBeenCalledOnce()
		expect(linter_arguments()[0]).toEqual(expect.arrayContaining([WHOLE_TREE, 'scripts/run/']))
	})
})

describe('CI whole-tree resource settings', () => {
	it('preserves CI whole-tree violations and gives eslint its heap (ac-2027cb4a)', async () => {
		vi.stubEnv('CI', 'true')
		vi.stubEnv('NODE_OPTIONS', '')
		mock_exit_codes(0, FAILED)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
		expect(mocked_execa.mock.calls.at(-1)?.[1]).toEqual([
			'exec',
			'eslint',
			WHOLE_TREE,
			...ESLINT_CACHE_FLAGS,
		])
		expect(mocked_execa).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining<Record<string, unknown>>({
				env: expect.objectContaining({ NODE_OPTIONS: COLD_OPTIONS }),
			}),
		)
	})
})

// joshuafolkken/kit#5116: the gate times `lint` as one step, so only this line says which of the two
// side-by-side tools is the long pole.
describe('lint_parallel.run_lint_command timing', () => {
	it('prints prettier and eslint seconds separately for a narrowed run', async () => {
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringMatching(TIMING_LINE))
	})

	it('prints them for a whole-tree run in CI', async () => {
		vi.stubEnv('CI', 'true')
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringMatching(TIMING_LINE))
	})

	it('prints them on a failed run too', async () => {
		mock_exit_codes(FAILED, 0)

		await expect(lint_parallel.run_lint_command(CHANGED_ARGUMENTS)).resolves.toBe(FAILED)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringMatching(TIMING_LINE))
	})

	it('starts the line on its own after an output with no final newline', async () => {
		mocked_execa
			.mockResolvedValueOnce(fake_result(0, PRETTIER_PASS))
			.mockResolvedValueOnce(fake_result(0))

		await lint_parallel.run_lint_command(CHANGED_ARGUMENTS)

		expect(process.stdout.write).toHaveBeenCalledWith(`${PRETTIER_PASS}\n`)
	})

	it('prints nothing of the kind without the flag', async () => {
		mock_exit_codes(0, 0)

		await lint_parallel.run_lint_command([])

		expect(process.stdout.write).not.toHaveBeenCalledWith(expect.stringMatching(TIMING_LINE))
	})
})
