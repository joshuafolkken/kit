import { existsSync, readFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { doctor_io } from './doctor-io'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_exists_sync = vi.mocked(existsSync)
const mocked_read_file_sync = vi.mocked(readFileSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const TOP_LEVEL = '/Users/example/project'
const TOP_LEVEL_OUTPUT = `${TOP_LEVEL}\n`
const KIT_DEPENDABOT_CONFIG =
	"version: 2\nupdates:\n  - package-ecosystem: 'npm'\n    open-pull-requests-limit: 0\n"
const FOREIGN_DEPENDABOT_CONFIG = "version: 2\nupdates:\n  - package-ecosystem: 'npm'\n"
// The same limit on a different ecosystem is not kit's change and must not be read as one.
const OTHER_ECOSYSTEM_DEPENDABOT_CONFIG =
	"version: 2\nupdates:\n  - package-ecosystem: 'docker'\n    open-pull-requests-limit: 0\n"
// The npm entry must be found even when it is not the first one listed.
const LATER_NPM_ENTRY_CONFIG =
	"version: 2\nupdates:\n  - package-ecosystem: 'github-actions'\n    directory: '/'\n  - package-ecosystem: 'npm'\n    open-pull-requests-limit: 0\n"
// kit's own template explains the option in prose that repeats the literal; a substring search would
// treat any file quoting that sentence as kit-distributed.
const COMMENT_ONLY_DEPENDABOT_CONFIG =
	'version: 2\n# `open-pull-requests-limit: 0` disables version updates only.\nupdates: []\n'
const GIT_OK_EXIT = 0
const GIT_NOT_A_REPOSITORY_EXIT = 128

// Every field is explicit: a default would fire on an explicitly-passed `undefined`, so the
// "git could not answer" cases would silently be exercised with exit code 0 instead.
interface GitOutcome {
	stdout: string | undefined
	exitCode: number | undefined
	stderr: string
}

function fake_result(outcome: GitOutcome): ExecaSyncResult {
	return outcome as unknown as ExecaSyncResult
}

function git_ran(stdout: string): ExecaSyncResult {
	return fake_result({ stdout, exitCode: GIT_OK_EXIT, stderr: '' })
}

function state_of(result: ExecaSyncResult): string {
	mocked_execa_sync.mockReturnValue(result)

	return doctor_io.resolve_git_top_level().state
}

function git_failed(stderr: string): ExecaSyncResult {
	return fake_result({ stdout: '', exitCode: GIT_NOT_A_REPOSITORY_EXIT, stderr })
}

beforeEach(() => {
	vi.resetAllMocks()
})

describe('resolve_git_top_level', () => {
	// Outside any repository git prints nothing and exits 128 — the one answer that proves absence.
	it('is outside when git reports there is no repository', () => {
		expect(
			state_of(git_failed('fatal: not a git repository (or any of the parent directories): .git')),
		).toBe('outside')
	})

	it('is inside when git prints a root', () => {
		expect(state_of(git_ran(TOP_LEVEL_OUTPUT))).toBe('inside')
	})

	it('returns the repository root, so the config is not resolved against the working directory', () => {
		mocked_execa_sync.mockReturnValue(git_ran(TOP_LEVEL_OUTPUT))
		const git = doctor_io.resolve_git_top_level()

		expect(git.state === 'inside' ? git.top_level : undefined).toBe(TOP_LEVEL)
	})

	// execa reports a spawn failure as `stdout: undefined`; trimming it unguarded would abort
	// `josh doctor` before it printed anything (joshuafolkken/kit#805).
	it('does not throw when git is not installed', () => {
		mocked_execa_sync.mockReturnValue(
			fake_result({ stdout: undefined, exitCode: undefined, stderr: '' }),
		)

		expect(() => doctor_io.resolve_git_top_level()).not.toThrow()
	})
})

describe('resolve_git_top_level — when git cannot answer', () => {
	// A missing `git` cannot prove absence, so the caller must keep reporting rather than skip.
	it('is undetermined when git is not installed', () => {
		expect(state_of(fake_result({ stdout: undefined, exitCode: undefined, stderr: '' }))).toBe(
			'undetermined',
		)
	})

	it('is undetermined when a timeout leaves git without an exit code', () => {
		expect(state_of(fake_result({ stdout: '', exitCode: undefined, stderr: '' }))).toBe(
			'undetermined',
		)
	})

	it('is undetermined when git succeeds but prints nothing', () => {
		expect(state_of(git_ran('\n'))).toBe('undetermined')
	})

	// Exit 128 is also what git returns inside a repository for dubious ownership, a corrupt `.git`,
	// or a broken config. Skipping there would be the false all-clear the feature exists to remove.
	it('is undetermined when git fails for a reason other than a missing repository', () => {
		expect(state_of(git_failed("fatal: detected dubious ownership in repository at '/repo'"))).toBe(
			'undetermined',
		)
	})

	it('bounds the call with a timeout', () => {
		mocked_execa_sync.mockReturnValue(git_ran('true\n'))
		doctor_io.resolve_git_top_level()

		expect(mocked_execa_sync).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], {
			reject: false,
			timeout: doctor_io.GIT_TIMEOUT_MS,
			// Pinned so the stderr match below is not defeated by a translated git message.
			env: { LC_ALL: 'C', LANGUAGE: 'C' },
			extendEnv: true,
		})
	})
})

// Existence alone is not enough: any project may ship its own Dependabot config, and warning there
// would advertise an enabling command for a repository that never consumed kit
// (joshuafolkken/kit#805).
describe('has_distributed_dependabot_config', () => {
	it('is true for a config that disables npm version updates', () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockReturnValue(KIT_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(true)
	})

	it("is false for a project's own Dependabot config", () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockReturnValue(FOREIGN_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(false)
	})

	it('is false when the limit belongs to a different ecosystem', () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockReturnValue(OTHER_ECOSYSTEM_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(false)
	})

	it('is true when the npm entry is not listed first', () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockReturnValue(LATER_NPM_ENTRY_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(true)
	})
})

describe('has_distributed_dependabot_config — rejecting foreign configs', () => {
	it('is false when the literal appears only inside a comment', () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockReturnValue(COMMENT_ONLY_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(false)
	})

	// `josh doctor` must not abort on a permission error or a race between the existence check and
	// the read — the check's contract is that it never fails the command.
	it('is false, and does not throw, when the config cannot be read', () => {
		mocked_exists_sync.mockReturnValue(true)
		mocked_read_file_sync.mockImplementation(() => {
			throw new Error('EACCES: permission denied')
		})

		expect(() => doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).not.toThrow()
		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(false)
	})

	it('is false when no config is present', () => {
		mocked_exists_sync.mockReturnValue(false)

		expect(doctor_io.has_distributed_dependabot_config(TOP_LEVEL)).toBe(false)
	})

	it('resolves the config against the supplied repository root', () => {
		mocked_exists_sync.mockReturnValue(false)
		doctor_io.has_distributed_dependabot_config(TOP_LEVEL)

		expect(mocked_exists_sync).toHaveBeenCalledWith(`${TOP_LEVEL}/.github/dependabot.yml`)
	})

	// Searching upward is what keeps the check alive from a subdirectory when git could not report
	// the repository root (joshuafolkken/kit#805).
	it('finds a config in an ancestor directory', () => {
		mocked_exists_sync.mockImplementation(
			(candidate) => candidate === `${TOP_LEVEL}/.github/dependabot.yml`,
		)
		mocked_read_file_sync.mockReturnValue(KIT_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(`${TOP_LEVEL}/scripts/doctor`)).toBe(true)
	})
})

describe('has_distributed_dependabot_config — search boundary', () => {
	// A repository nested under a kit consumer must not inherit the parent's config.
	it('does not search above the supplied boundary', () => {
		mocked_exists_sync.mockImplementation(
			(candidate) => candidate === `${TOP_LEVEL}/.github/dependabot.yml`,
		)
		const nested = `${TOP_LEVEL}/vendor/nested`

		expect(doctor_io.has_distributed_dependabot_config(nested, nested)).toBe(false)
	})

	it('searches up to the boundary inclusive', () => {
		mocked_exists_sync.mockImplementation(
			(candidate) => candidate === `${TOP_LEVEL}/.github/dependabot.yml`,
		)
		mocked_read_file_sync.mockReturnValue(KIT_DEPENDABOT_CONFIG)

		expect(doctor_io.has_distributed_dependabot_config(`${TOP_LEVEL}/scripts`, TOP_LEVEL)).toBe(
			true,
		)
	})

	it('stops at the filesystem root when no config exists anywhere above', () => {
		mocked_exists_sync.mockReturnValue(false)

		expect(doctor_io.has_distributed_dependabot_config(`${TOP_LEVEL}/scripts`)).toBe(false)
	})
})
