import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/build/local-bin', () => ({ resolve_package_bin: vi.fn() }))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))

const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)
const { resolve_package_bin } = await import('#scripts/build/local-bin')
const mocked_resolve = vi.mocked(resolve_package_bin)
const { git_spawn_sync } = await import('#scripts/git/git-spawn-sync')
const mocked_git_read = vi.mocked(git_spawn_sync.read)
const { eslint_daemon } = await import('./eslint-daemon')

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const CLI = '/kit/node_modules/eslint_d/bin/eslint_d.js'
const TARGET = 'src/a.ts'
const PNPM_ESLINT = ['exec', 'eslint', '--quiet', TARGET]
const OLDER_S = 1000
const NEWER_S = 2000
const MS_PER_S = 1000
const RULE_MODULE = 'eslint/rules/a-rule.js'
const CONFIG_ENTRY = 'eslint.config.js'
const PNPM_PRETTIER = ['exec', 'prettier', TARGET]
// What `git rev-parse --git-path logs/HEAD` prints in a main checkout: relative to the work tree.
const HEAD_REFLOG = '.git/logs/HEAD'

const project_root = mkdtempSync(path.join(tmpdir(), 'eslint-daemon-'))

function answer(exit_code: number, stdout: string): ExecaResult {
	return { exitCode: exit_code, stdout, all: stdout } as unknown as ExecaResult
}

function write_file(relative: string, mtime_s: number): void {
	const file = path.join(project_root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	// Valid JSON, because module resolution parses each `package.json` it passes.
	writeFileSync(file, '{}')
	utimesSync(file, mtime_s, mtime_s)
}

// A checkout whose daemon started at `started_s` and whose newest config input was written at
// `config_s`.
function checkout(started_s: number, config_s: number): void {
	write_file('package.json', OLDER_S)
	write_file('node_modules/eslint/package.json', OLDER_S)
	write_file('node_modules/eslint/.eslint_d', started_s)
	write_file(RULE_MODULE, config_s)
}

beforeEach(() => {
	vi.clearAllMocks()
	mkdirSync(project_root, { recursive: true })
	mocked_resolve.mockReturnValue(CLI)
	mocked_git_read.mockReturnValue(undefined)
})

afterEach(() => {
	rmSync(project_root, { recursive: true, force: true })
})

describe('eslint_daemon.eslint_arguments_of', () => {
	it('takes the eslint arguments of a pnpm exec eslint list', () => {
		expect(eslint_daemon.eslint_arguments_of(PNPM_ESLINT)).toEqual(['--quiet', TARGET])
	})

	it('answers nothing for another tool', () => {
		expect(eslint_daemon.eslint_arguments_of(PNPM_PRETTIER)).toBeUndefined()
	})
})

describe('eslint_daemon.is_config_input', () => {
	it.each([RULE_MODULE, CONFIG_ENTRY, 'eslint.config.mts'])('reads %s', (file) => {
		expect(eslint_daemon.is_config_input(file)).toBe(true)
	})

	it('leaves a source file alone', () => {
		expect(eslint_daemon.is_config_input('scripts/eslint.ts')).toBe(false)
	})
})

describe('eslint_daemon.is_stale', () => {
	it('is stale when a config input is newer than the daemon', () => {
		expect(eslint_daemon.is_stale(OLDER_S, NEWER_S)).toBe(true)
	})

	it('is current when the daemon started after every config input', () => {
		expect(eslint_daemon.is_stale(NEWER_S, OLDER_S)).toBe(false)
	})

	it('is current when no daemon has started', () => {
		expect(eslint_daemon.is_stale(undefined, NEWER_S)).toBe(false)
	})
})

describe('eslint_daemon.newest_config_mtime', () => {
	it('reads the newest of the config entry and the modules under eslint/', () => {
		write_file(CONFIG_ENTRY, OLDER_S)
		write_file(RULE_MODULE, NEWER_S)
		write_file('src/newest.ts', NEWER_S + NEWER_S)

		expect(eslint_daemon.newest_config_mtime(project_root)).toBe(NEWER_S * MS_PER_S)
	})

	it('reads the root config entry when it is the newest input', () => {
		write_file(RULE_MODULE, OLDER_S)
		write_file(CONFIG_ENTRY, NEWER_S)

		expect(eslint_daemon.newest_config_mtime(project_root)).toBe(NEWER_S * MS_PER_S)
	})

	it.each(['pnpm-lock.yaml', 'node_modules/.modules.yaml'])(
		'reads the dependency install marker %s',
		(marker) => {
			write_file(CONFIG_ENTRY, OLDER_S)
			write_file(marker, NEWER_S)

			expect(eslint_daemon.newest_config_mtime(project_root)).toBe(NEWER_S * MS_PER_S)
		},
	)

	// joshuafolkken/kit#4443: a merge moves sources the daemon's type program read but never linted.
	it("reads the work tree's HEAD reflog that a merge or checkout appends to", () => {
		write_file(CONFIG_ENTRY, OLDER_S)
		write_file(HEAD_REFLOG, NEWER_S)
		mocked_git_read.mockReturnValue(HEAD_REFLOG)

		expect(eslint_daemon.newest_config_mtime(project_root)).toBe(NEWER_S * MS_PER_S)
		expect(mocked_git_read).toHaveBeenCalledWith(['rev-parse', '--git-path', 'logs/HEAD'], {
			cwd: project_root,
		})
	})

	it('skips a config input that is gone by the time it is read', () => {
		write_file(RULE_MODULE, NEWER_S)
		symlinkSync(path.join(project_root, 'missing.js'), path.join(project_root, CONFIG_ENTRY))

		expect(eslint_daemon.newest_config_mtime(project_root)).toBe(NEWER_S * MS_PER_S)
	})
})

describe('eslint_daemon.run', () => {
	it('forwards the eslint arguments to the daemon from the project root', async () => {
		checkout(NEWER_S, OLDER_S)
		mocked_execa.mockResolvedValueOnce(answer(1, 'report'))

		expect(await eslint_daemon.run(PNPM_ESLINT, { project_root })).toEqual({
			exit_code: 1,
			stdout: 'report',
			output: 'report',
		})
		expect(mocked_execa).toHaveBeenCalledExactlyOnceWith(
			process.execPath,
			[CLI, '--quiet', TARGET],
			expect.objectContaining({ cwd: project_root }),
		)
		expect(mocked_execa.mock.lastCall?.at(-1)).toMatchObject({ env: { ESLINT_D_MISS: 'fail' } })
	})

	it('stops a daemon older than its config before linting', async () => {
		checkout(OLDER_S, NEWER_S)
		mocked_execa.mockResolvedValue(answer(0, ''))

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual([CLI, '--quiet', TARGET])
	})

	it('answers nothing when the daemon failed to start', async () => {
		mocked_execa.mockResolvedValueOnce(answer(1, ''))

		expect(await eslint_daemon.run(PNPM_ESLINT, { project_root })).toBeUndefined()
	})
})

// joshuafolkken/kit#4443: a daemon whose config is current still holds the pre-merge types.
describe('eslint_daemon.run — after a merge', () => {
	it('stops a daemon started before the last merge before linting', async () => {
		checkout(NEWER_S, OLDER_S)
		write_file(HEAD_REFLOG, NEWER_S + NEWER_S)
		mocked_git_read.mockReturnValue(HEAD_REFLOG)
		mocked_execa.mockResolvedValue(answer(0, ''))

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual([CLI, '--quiet', TARGET])
	})
})

describe('eslint_daemon.run — nothing to reach', () => {
	it('answers nothing without a daemon installed', async () => {
		mocked_resolve.mockReturnValue(undefined)

		expect(await eslint_daemon.run(PNPM_ESLINT, { project_root })).toBeUndefined()
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('reaches no daemon for a project that borrows its node_modules through a symlink', async () => {
		const lender = mkdtempSync(path.join(tmpdir(), 'eslint-daemon-lender-'))

		try {
			symlinkSync(lender, path.join(project_root, 'node_modules'), 'dir')

			expect(eslint_daemon.resolve_daemon_cli(project_root)).toBeUndefined()
			expect(await eslint_daemon.run(PNPM_ESLINT, { project_root })).toBeUndefined()
			expect(mocked_execa).not.toHaveBeenCalled()
		} finally {
			rmSync(lender, { recursive: true, force: true })
		}
	})

	it('reaches the daemon for a project with a node_modules of its own', () => {
		mkdirSync(path.join(project_root, 'node_modules'))

		expect(eslint_daemon.resolve_daemon_cli(project_root)).toBe(CLI)
	})

	it('spawns nothing for a run of another tool', async () => {
		expect(await eslint_daemon.run(PNPM_PRETTIER, { project_root })).toBeUndefined()
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4358: the one fallback `josh lint:related` and the pre-commit hook share.
describe('eslint_daemon.run_or_cold', () => {
	it('answers with the daemon report when the daemon answers', async () => {
		mocked_execa.mockResolvedValueOnce(answer(1, 'report'))

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			exit_code: 1,
			output: 'report',
		})
		expect(mocked_execa).toHaveBeenCalledOnce()
	})

	it('runs the cold pnpm eslint when the daemon cannot answer', async () => {
		mocked_resolve.mockReturnValue(undefined)
		mocked_execa.mockResolvedValueOnce(answer(0, 'cold'))

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({ exit_code: 0 })
		expect(mocked_execa).toHaveBeenCalledExactlyOnceWith('pnpm', PNPM_ESLINT, expect.anything())
	})
})
