import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { git_location_environment } from './git/git-location-environment'
import { test_network_guard } from './test-network-guard'
import { test_repository_guard } from './test-repository-guard'

// joshuafolkken/kit#1530. The guard's own defects fail open exactly as the network guard's do — a
// shim that never refuses and a run that never wrote look alike from the outside — so every case
// below generates the shim, spawns it against real repositories and reads back what it did, rather
// than asserting on the text it would have generated.

const BLOCKED_EXIT_CODE = 1
const TEMP_PREFIX = 'josh-repository-guard-'
const COMMIT_ARGUMENTS = ['commit', '--allow-empty', '-m', 'fixture']
const READ_ARGUMENTS = ['rev-parse', '--is-inside-work-tree']
const INIT_ARGUMENTS = ['init', '--initial-branch=main']
const GIT_DIRECTORY = '.git'
const REAL_GIT = test_network_guard.GIT_BINARY ?? test_network_guard.GIT_SHIM_NAME
const NETWORK_CALL = 'gh api repos/joshuafolkken/kit/issues/1'

const directories: Array<string> = []

function temporary_directory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

	directories.push(directory)

	return directory
}

afterEach(() => {
	for (const directory of directories) rmSync(directory, { recursive: true, force: true })
	directories.length = 0
})

// The fixtures are built with the real binary and a cleared environment, which is the very idiom
// under test — a setup that went through the shim would be asserting on itself.
function real_git(cwd: string, args: Array<string>): void {
	execaSync(REAL_GIT, args, {
		cwd,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
	})
}

function build_repository(): string {
	const root = temporary_directory()

	real_git(root, INIT_ARGUMENTS)

	return root
}

function guarded_of(repository: string): string | undefined {
	return test_repository_guard.guarded_git_directory(REAL_GIT, repository)
}

interface Invocation {
	guarded: string | undefined
	cwd: string
	env?: Record<string, string | undefined>
	args: Array<string>
}

interface ShimRun {
	exit_code: number | undefined
	stderr: string
	log: string
}

function run_shim(invocation: Invocation): ShimRun {
	const directory = temporary_directory()

	test_network_guard.install_shim(directory, invocation.guarded)

	const shim = path.join(directory, test_network_guard.GIT_SHIM_NAME)
	const result = execaSync(shim, invocation.args, {
		cwd: invocation.cwd,
		reject: false,
		env: { ...git_location_environment.location_free_environment(), ...invocation.env },
		extendEnv: true,
	})

	return {
		exit_code: result.exitCode,
		stderr: result.stderr,
		log: readFileSync(test_network_guard.log_in(directory), 'utf8'),
	}
}

describe('the write guard — an inherited git environment', () => {
	// The exact shape of both instances: `GIT_DIR` beats `cwd`, so the command is refused whatever it
	// was aimed at rather than after working out where it would have landed.
	it('refuses a writing subcommand and names the variable it found', () => {
		const repository = build_repository()
		const blocked = run_shim({
			args: COMMIT_ARGUMENTS,
			cwd: repository,
			env: { GIT_DIR: path.join(repository, GIT_DIRECTORY) },
			guarded: undefined,
		})

		expect(blocked.exit_code).toBe(BLOCKED_EXIT_CODE)
		expect(blocked.stderr).toContain('GIT_DIR')
		expect(blocked.stderr).toContain(test_repository_guard.BLOCKED_WRITE_MESSAGE)
	})

	// The backstop for a test that swallows the error: the record has to carry the command even when
	// nobody read the stderr.
	it('records the command it refused', () => {
		const repository = build_repository()
		const blocked = run_shim({
			args: COMMIT_ARGUMENTS,
			cwd: repository,
			env: { GIT_INDEX_FILE: path.join(repository, GIT_DIRECTORY, 'index') },
			guarded: undefined,
		})

		expect(blocked.log).toContain(test_repository_guard.WRITE_MARKER)
		expect(blocked.log).toContain('commit')
	})
})

describe('the write guard — a read under an inherited git environment', () => {
	// A read cannot move a branch, and half the suite reads the repository it is running in.
	it('is handed to the real binary even with the environment set', () => {
		const repository = build_repository()
		const passed = run_shim({
			args: READ_ARGUMENTS,
			cwd: repository,
			env: { GIT_DIR: path.join(repository, GIT_DIRECTORY) },
			guarded: undefined,
		})

		expect(passed.exit_code).toBe(0)
		expect(passed.log).toBe('')
	})
})

describe('the write guard — a working directory inside the guarded repository', () => {
	// The environment can be clean and the write still land here, by way of an ambient `cwd`.
	it('refuses a writing subcommand and names the repository it resolved to', () => {
		const repository = build_repository()
		const guarded = guarded_of(repository)
		const blocked = run_shim({ args: COMMIT_ARGUMENTS, cwd: repository, guarded })

		expect(blocked.exit_code).toBe(BLOCKED_EXIT_CODE)
		expect(blocked.stderr).toContain(guarded ?? '')
		expect(blocked.log).toContain(test_repository_guard.WRITE_MARKER)
	})

	// The half that must keep working: a fixture in a temp directory is what these suites are for.
	it('hands a write aimed somewhere else to the real binary', () => {
		const passed = run_shim({
			args: INIT_ARGUMENTS,
			cwd: temporary_directory(),
			guarded: guarded_of(build_repository()),
		})

		expect(passed.exit_code).toBe(0)
		expect(passed.log).toBe('')
	})

	it('lets a read against the guarded repository through', () => {
		const repository = build_repository()
		const passed = run_shim({
			args: READ_ARGUMENTS,
			cwd: repository,
			guarded: guarded_of(repository),
		})

		expect(passed.exit_code).toBe(0)
		expect(passed.log).toBe('')
	})
})

// The resolution is asked with the caller's own global options in front of it, so both directions of
// the defect review round 1 found are pinned here.
describe('the write guard — a repository named by a global option', () => {
	// The bypass: `--git-dir` reaches the guarded repository from a working directory that is nowhere
	// near it, so a resolution taken from `cwd` alone answers "not here".
	it('refuses a write aimed at the guarded repository by --git-dir from outside it', () => {
		const repository = build_repository()
		const blocked = run_shim({
			args: ['--git-dir', path.join(repository, GIT_DIRECTORY), ...COMMIT_ARGUMENTS],
			cwd: temporary_directory(),
			guarded: guarded_of(repository),
		})

		expect(blocked.log).toContain(test_repository_guard.WRITE_MARKER)
	})

	// The false positive of the same defect, in the other direction: `-C` moves the command out of the
	// guarded repository, and a resolution from `cwd` refused a write that targeted a fixture.
	it('lets a write through that -C moved out of the guarded repository', () => {
		const repository = build_repository()
		const passed = run_shim({
			args: ['-C', temporary_directory(), ...INIT_ARGUMENTS],
			cwd: repository,
			guarded: guarded_of(repository),
		})

		expect(passed.exit_code).toBe(0)
		expect(passed.log).toBe('')
	})
})

// The subcommands whose reading spelling this suite uses. They face the environment finding only,
// because an ambient `cwd` inside the checkout is how a legitimate read of it is spelled.
describe('the write guard — subcommands that read as often as they write', () => {
	it('lets a read through from inside the guarded repository', () => {
		const repository = build_repository()
		const passed = run_shim({
			args: ['worktree', 'list'],
			cwd: repository,
			guarded: guarded_of(repository),
		})

		expect(passed.exit_code).toBe(0)
		expect(passed.log).toBe('')
	})

	// An inherited environment is wrong for these too: it is what made the readings in
	// joshuafolkken/kit#1530 answer about the repository being pushed.
	it('still refuses one that inherited a git location variable', () => {
		const repository = build_repository()
		const blocked = run_shim({
			args: ['config', 'user.email', 'lane@example.test'],
			cwd: repository,
			env: { GIT_DIR: path.join(repository, GIT_DIRECTORY) },
			guarded: guarded_of(repository),
		})

		expect(blocked.exit_code).toBe(BLOCKED_EXIT_CODE)
		expect(blocked.log).toContain(test_repository_guard.WRITE_MARKER)
	})
})

describe('test_repository_guard.guarded_git_directory', () => {
	it('answers the shared git directory of a repository', () => {
		const repository = build_repository()

		expect(guarded_of(repository)).toContain(GIT_DIRECTORY)
	})

	// Not an unknown but an answer: there is no repository here for a test to damage, so the shim is
	// generated without the resolution finding and keeps the environment one.
	it('answers undefined where there is no repository', () => {
		expect(guarded_of(temporary_directory())).toBeUndefined()
	})

	// Every other failure is a guard that does not know what it guards, and reporting `undefined`
	// there would drop the finding for the whole run while the run still read as clean.
	it('throws rather than answering undefined when it could not ask at all', () => {
		expect(() => guarded_of(path.join(temporary_directory(), 'absent'))).toThrow(
			test_repository_guard.RESOLUTION_HEADING,
		)
	})
})

describe('the shared record still says which guard caught which call', () => {
	it('reports a repository write under its own heading', () => {
		const message = test_network_guard.describe_violations([
			`${test_repository_guard.WRITE_MARKER} git commit`,
		])

		expect(message).toContain(test_repository_guard.WRITE_VIOLATION_HEADING)
		expect(message).not.toContain(test_network_guard.VIOLATION_HEADING)
	})

	it('reports a network call under the network heading', () => {
		const message = test_network_guard.describe_violations([NETWORK_CALL])

		expect(message).toContain(test_network_guard.VIOLATION_HEADING)
		expect(message).not.toContain(test_repository_guard.WRITE_VIOLATION_HEADING)
	})

	// One run can do both, and filing one under the other's heading tells the reader to mock a read
	// that was never made.
	it('reports both when the run did both', () => {
		const message = test_network_guard.describe_violations([
			NETWORK_CALL,
			`${test_repository_guard.WRITE_MARKER} git commit`,
		])

		expect(message).toContain(test_network_guard.VIOLATION_HEADING)
		expect(message).toContain(test_repository_guard.WRITE_VIOLATION_HEADING)
	})
})

// **The one case that is about this very run.** Everything above builds a shim for the test; this
// asks whether the suite it is running inside is behind one that carries the write arm at all.
describe('the write guard — armed for the run this test is part of', () => {
	it('has the write arm in the shim on PATH', () => {
		const first_entry = (process.env['PATH'] ?? '').split(path.delimiter)[0] ?? ''

		// Asserted before the read, so a `PATH` nothing armed says so rather than failing as an opaque
		// `ENOENT` on a file that was never written.
		expect(first_entry).toContain(test_network_guard.GUARD_PREFIX)

		const script = readFileSync(path.join(first_entry, test_network_guard.GIT_SHIM_NAME), 'utf8')

		expect(script).toContain(test_repository_guard.WRITE_MARKER)
		expect(script).toContain('GIT_INDEX_FILE')
	})
})
