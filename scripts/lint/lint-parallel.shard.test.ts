import { project_checks } from '#scripts/gate/project-checks'
import { ESLINT_CACHE_FILE } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import { fake_result } from '#tools/test/execa-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lint_shard } from './lint-shard'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/build/local-bin', async () => await import('#tools/test/local-bin-mock'))
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
vi.mock('./import-cycles', () => ({ import_cycles: { run: vi.fn() } }))

const { import_cycles } = await import('./import-cycles')
const mocked_cycles = vi.mocked(import_cycles.run)
const { lint_parallel, PRETTIER_ARGS } = await import('./lint-parallel')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const mocked_cache_run = vi.mocked(lane_cache_run.run)

const CLEAN_CYCLES = {
	output: 'josh import-cycles: no import cycle\n',
	exit_code: 0,
	elapsed_ms: 0,
}
const FOUND_CYCLE = {
	output: 'josh import-cycles: 1 import cycle(s)\n',
	exit_code: 1,
	elapsed_ms: 0,
}

function mock_exit_codes(prettier_code: number, eslint_code: number): void {
	mocked_execa
		.mockResolvedValueOnce(fake_result(prettier_code))
		.mockResolvedValueOnce(fake_result(eslint_code))
}

beforeEach(() => {
	vi.restoreAllMocks()
	mocked_cycles.mockReset().mockResolvedValue(CLEAN_CYCLES)
})

// joshuafolkken/kit#6997: a `--shard` run hands eslint the shard's targets on the same cache file,
// and only shard 1 checks formatting.
describe('josh lint --shard', () => {
	it('lints shard 1 with prettier over the whole tree', async () => {
		mock_exit_codes(0, 0)

		expect(await lint_parallel.run_lint_command(['--shard=1'])).toBe(0)
		expect(mocked_execa.mock.calls[0]?.[1]).toEqual(PRETTIER_ARGS)
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual(
			expect.arrayContaining([...lint_shard.FIRST_SHARD_DIRECTORIES]),
		)
		expect(mocked_cache_run).toHaveBeenCalledWith(ESLINT_CACHE_FILE, expect.any(Function))
	})

	it('lints shard 1 with the prettier targets the project formats (josh.format)', async () => {
		vi.spyOn(project_checks, 'prettier_targets').mockReturnValue([project_checks.WEB_FILES])
		mock_exit_codes(0, 0)
		await lint_parallel.run_lint_command(['--shard=1'])
		expect(mocked_execa.mock.calls[0]?.[1]).toContain(project_checks.WEB_FILES)
	})

	it('lints shard 2 alone, saying prettier is left to shard 1', async () => {
		mocked_execa.mockResolvedValueOnce(fake_result(0))
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await lint_parallel.run_lint_command(['--shard=2'])).toBe(0)
		expect(mocked_execa).toHaveBeenCalledOnce()
		expect(mocked_execa.mock.calls[0]?.[1]).toContain('--ignore-pattern')
		expect(stdout).toHaveBeenCalledWith(expect.stringContaining(lint_shard.FORMATTING_SHARD_REASON))
	})
})

// joshuafolkken/kit#8887: the import cycles are read once per run, beside the linters, by the run that
// checks formatting — a run with no shard, or shard 1 — and a cycle fails the run however the linters did.
describe('josh lint — the whole-tree import cycle check', () => {
	it.each([[[]], [['--shard=1']]])('checks the cycles once on %j and prints them', async (argv) => {
		mock_exit_codes(0, 0)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await lint_parallel.run_lint_command(argv)).toBe(0)
		expect(mocked_cycles).toHaveBeenCalledExactlyOnceWith(process.cwd())
		expect(stdout).toHaveBeenCalledWith(CLEAN_CYCLES.output)
	})

	it('leaves the cycles to shard 1 on shard 2', async () => {
		mocked_execa.mockResolvedValueOnce(fake_result(0))
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await lint_parallel.run_lint_command(['--shard=2'])

		expect(mocked_cycles).not.toHaveBeenCalled()
	})

	it('fails a run whose linters pass when a cycle is found', async () => {
		mock_exit_codes(0, 0)
		mocked_cycles.mockResolvedValue(FOUND_CYCLE)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await lint_parallel.run_lint_command([])).toBe(1)
		expect(stdout).toHaveBeenCalledWith(FOUND_CYCLE.output)
	})

	// `josh lint:related` hands its linters' exit code in with no shard, since its green stands in for
	// the gate's lint.
	it('fails a green lint handed in with no shard when a cycle is found', async () => {
		mocked_cycles.mockResolvedValue(FOUND_CYCLE)
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		expect(await lint_parallel.with_import_cycles(Promise.resolve(0))).toBe(1)
		expect(mocked_cycles).toHaveBeenCalledExactlyOnceWith(process.cwd())
	})
})
