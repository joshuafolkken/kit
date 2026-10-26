import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
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
const NEWER_S = 2000
const RULE_MODULE = 'eslint/rules/a-rule.js'
const CONFIG_ENTRY = 'eslint.config.js'
const TSCONFIG = 'tsconfig.json'
const TSCONFIG_BASE = 'tsconfig/base.json'
const LOCKFILE = 'pnpm-lock.yaml'
const INSTALL_RECORD = 'node_modules/.modules.yaml'
const PNPM_PRETTIER = ['exec', 'prettier', TARGET]
const ESLINT_DIRECTORY = 'node_modules/eslint'
const DAEMON = 'token 4321 77 hash'
// Valid JSON, because module resolution parses each `package.json` it passes.
const JSON_BODY = '{}'
const CHANGED = '{ "changed": true }'
const HEAD_BEFORE = 'aaaa'
const HEAD_AFTER = 'bbbb'
const LIST_FILES = ['ls-files', '--cached', '--others', '--exclude-standard']
const NEW_MODULE = 'src/new-module.ts'
const FILES_BEFORE = TARGET
const FILES_AFTER = `${TARGET}\n${NEW_MODULE}`

const project_root = mkdtempSync(path.join(tmpdir(), 'eslint-daemon-'))

function answer(exit_code: number, stdout: string): ExecaResult {
	return { exitCode: exit_code, stdout, all: stdout } as unknown as ExecaResult
}

function write_file(relative: string, content: string = JSON_BODY): void {
	const file = path.join(project_root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

// A checkout with an installed eslint whose daemon runs, recorded under nothing yet.
function checkout(): void {
	for (const input of ['package.json', `${ESLINT_DIRECTORY}/package.json`, RULE_MODULE]) {
		write_file(input)
	}

	write_file(`${ESLINT_DIRECTORY}/.eslint_d`, DAEMON)
}

// git under one commit, listing `files` as the ones the type program can resolve.
function answer_git(files: string): void {
	mocked_git_read.mockImplementation((git_arguments) =>
		git_arguments[0] === LIST_FILES[0] ? files : HEAD_BEFORE,
	)
}

function recorded_text(): string {
	return readFileSync(path.join(project_root, ESLINT_DIRECTORY, '.eslint_d-toolchain'), 'utf8')
}

// A checkout whose running daemon was recorded under the fingerprint it has now.
function current_checkout(): void {
	checkout()
	write_file(
		`${ESLINT_DIRECTORY}/.eslint_d-toolchain`,
		eslint_daemon.record_text(DAEMON, eslint_daemon.fingerprint(project_root)),
	)
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
	it.each([RULE_MODULE, CONFIG_ENTRY, 'eslint.config.mts', TSCONFIG, TSCONFIG_BASE])(
		'reads %s',
		(file) => {
			expect(eslint_daemon.is_config_input(file)).toBe(true)
		},
	)

	it('leaves a source file alone', () => {
		expect(eslint_daemon.is_config_input('scripts/eslint.ts')).toBe(false)
	})
})

// joshuafolkken/kit#4496: what the daemon is current for, by content rather than by time.
describe('eslint_daemon.fingerprint', () => {
	it.each([RULE_MODULE, CONFIG_ENTRY, TSCONFIG, TSCONFIG_BASE, LOCKFILE, INSTALL_RECORD])(
		'moves when %s is written',
		(input) => {
			checkout()
			const before = eslint_daemon.fingerprint(project_root)

			write_file(input, CHANGED)

			expect(eslint_daemon.fingerprint(project_root)).not.toBe(before)
		},
	)

	it('stays while only a source moves, whatever its time', () => {
		checkout()
		const before = eslint_daemon.fingerprint(project_root)

		write_file(TARGET, CHANGED)
		utimesSync(path.join(project_root, RULE_MODULE), NEWER_S, NEWER_S)

		expect(eslint_daemon.fingerprint(project_root)).toBe(before)
	})

	// joshuafolkken/kit#4443: a merge moves sources the daemon's type program read but never linted.
	it('moves with the commit checked out', () => {
		checkout()
		mocked_git_read.mockReturnValue(HEAD_BEFORE)
		const before = eslint_daemon.fingerprint(project_root)

		mocked_git_read.mockReturnValue(HEAD_AFTER)

		expect(eslint_daemon.fingerprint(project_root)).not.toBe(before)
		expect(mocked_git_read).toHaveBeenCalledWith(['rev-parse', 'HEAD'], { cwd: project_root })
	})

	// joshuafolkken/kit#4701: a merge in progress brings new modules in without moving HEAD.
	it('moves when a file is added under the same commit', () => {
		checkout()
		answer_git(FILES_BEFORE)
		const before = eslint_daemon.fingerprint(project_root)

		answer_git(FILES_AFTER)

		expect(eslint_daemon.fingerprint(project_root)).not.toBe(before)
		expect(mocked_git_read).toHaveBeenCalledWith(LIST_FILES, { cwd: project_root })
	})
})

describe('eslint_daemon.is_stale', () => {
	const current = 'fingerprint'

	it('is current when the running daemon was recorded under this fingerprint', () => {
		const record = { daemon: DAEMON, recorded: eslint_daemon.record_text(DAEMON, current) }

		expect(eslint_daemon.is_stale(record, current)).toBe(false)
	})

	it('is current when no daemon runs', () => {
		expect(eslint_daemon.is_stale({ daemon: undefined, recorded: undefined }, current)).toBe(false)
	})

	it('is stale when the fingerprint moved since the daemon started', () => {
		const record = { daemon: DAEMON, recorded: eslint_daemon.record_text(DAEMON, 'older') }

		expect(eslint_daemon.is_stale(record, current)).toBe(true)
	})

	it.each([undefined, eslint_daemon.record_text('another daemon', 'fingerprint')])(
		'is stale for a daemon nothing recorded (%s)',
		(recorded) => {
			expect(eslint_daemon.is_stale({ daemon: DAEMON, recorded }, current)).toBe(true)
		},
	)
})

describe('eslint_daemon.read_record', () => {
	it('reads nothing without an installed eslint', () => {
		expect(eslint_daemon.read_record(project_root)).toStrictEqual({
			daemon: undefined,
			recorded: undefined,
		})
	})
})

describe('eslint_daemon.remember_after_edit', () => {
	it('records a daemon the edit hook started, so the next run keeps it', () => {
		const before = eslint_daemon.read_record(project_root)

		checkout()
		eslint_daemon.remember_after_edit(project_root, before, TARGET)

		const current = eslint_daemon.fingerprint(project_root)

		expect(eslint_daemon.is_stale(eslint_daemon.read_record(project_root), current)).toBe(false)
	})

	it('leaves a daemon that ran before the edit hook unrecorded', () => {
		checkout()
		eslint_daemon.remember_after_edit(project_root, eslint_daemon.read_record(project_root), TARGET)

		expect(eslint_daemon.read_record(project_root).recorded).toBeUndefined()
	})
})

describe('eslint_daemon.run', () => {
	// joshuafolkken/kit#5047: the bound reaches the process, so a daemon that never answers is killed.
	it('forwards the eslint arguments to the daemon from the project root', async () => {
		current_checkout()
		mocked_execa.mockResolvedValueOnce(answer(1, 'report'))

		expect(await eslint_daemon.run(PNPM_ESLINT, { project_root, timeout_ms: 5 })).toEqual({
			exit_code: 1,
			stdout: 'report',
			output: 'report',
		})
		expect(mocked_execa).toHaveBeenCalledExactlyOnceWith(
			process.execPath,
			[CLI, '--quiet', TARGET],
			expect.objectContaining({ cwd: project_root, timeout: 5 }),
		)
		expect(mocked_execa.mock.lastCall?.at(-1)).toMatchObject({ env: { ESLINT_D_MISS: 'fail' } })
	})

	it('answers nothing when the daemon failed to start', async () => {
		mocked_execa.mockResolvedValueOnce(answer(1, ''))

		expect(await eslint_daemon.run(PNPM_ESLINT, { project_root })).toBeUndefined()
	})
})

describe('eslint_daemon.run — a stale daemon', () => {
	it('stops a daemon whose config moved since it started before linting', async () => {
		current_checkout()
		write_file(RULE_MODULE, CHANGED)
		mocked_execa.mockResolvedValue(answer(0, ''))

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual([CLI, '--quiet', TARGET])
	})

	it('stops a daemon nothing recorded, then records the one that answered', async () => {
		checkout()
		mocked_execa.mockResolvedValue(answer(0, ''))

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(recorded_text()).toBe(
			eslint_daemon.record_text(DAEMON, eslint_daemon.fingerprint(project_root)),
		)
	})
})

// joshuafolkken/kit#4443: a daemon whose config is current still holds the pre-merge types.
describe('eslint_daemon.run — after a merge', () => {
	it('stops a daemon started before the last merge before linting', async () => {
		mocked_git_read.mockReturnValue(HEAD_BEFORE)
		current_checkout()
		mocked_git_read.mockReturnValue(HEAD_AFTER)
		mocked_execa.mockResolvedValue(answer(0, ''))

		await eslint_daemon.run(PNPM_ESLINT, { project_root })

		expect(mocked_execa.mock.calls[0]?.[1]).toEqual([CLI, 'stop'])
		expect(mocked_execa.mock.calls[1]?.[1]).toEqual([CLI, '--quiet', TARGET])
	})

	// joshuafolkken/kit#4701: the daemon kept the failed lookup of a module the merge then brought in.
	it('stops a daemon started before a new module and its import arrived, HEAD unmoved', async () => {
		answer_git(FILES_BEFORE)
		current_checkout()
		answer_git(FILES_AFTER)
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
// `run_or_cold` reads the current directory, so each test pins it to the temporary checkout rather
// than the live one, whose daemon state would decide whether a `stop` runs (joshuafolkken/kit#4469).
describe('eslint_daemon.run_or_cold', () => {
	beforeEach(() => {
		vi.spyOn(process, 'cwd').mockReturnValue(project_root)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('answers with the daemon report when the daemon answers', async () => {
		current_checkout()
		mocked_execa.mockResolvedValueOnce(answer(1, 'report'))

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			exit_code: 1,
			output: 'report',
		})
		expect(mocked_execa).toHaveBeenCalledOnce()
	})

	it('answers with the daemon report after stopping a stale daemon', async () => {
		checkout()
		mocked_execa.mockResolvedValueOnce(answer(0, '')).mockResolvedValueOnce(answer(1, 'report'))

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({
			exit_code: 1,
			output: 'report',
		})
		expect(mocked_execa.mock.calls.map((call) => call[1])).toEqual([
			[CLI, 'stop'],
			[CLI, '--quiet', TARGET],
		])
	})

	it('runs the cold pnpm eslint when the daemon cannot answer', async () => {
		mocked_resolve.mockReturnValue(undefined)
		mocked_execa.mockResolvedValueOnce(answer(0, 'cold'))

		expect(await eslint_daemon.run_or_cold(PNPM_ESLINT)).toMatchObject({ exit_code: 0 })
		expect(mocked_execa).toHaveBeenCalledExactlyOnceWith('pnpm', PNPM_ESLINT, expect.anything())
	})
})
