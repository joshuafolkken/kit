import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BINARY_KEY } from './constants'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { git_pre_push_hook } from './git-pre-push-hook'
import { git_spawn } from './git-spawn'

const WORKSPACE_PREFIX = 'kit-pre-push-hook-'
const REPOSITORY = 'repository'
const REMOTE = 'remote.git'
const HOOKS = 'hooks'
const ARGUMENTS_FILE = 'arguments.txt'
const STDIN_FILE = 'stdin.txt'
const MAIN_REFERENCE = 'refs/heads/main'
const HEAD = 'HEAD'
const TRACKING_REFERENCE = 'refs/remotes/origin/main'
const EXECUTABLE_MODE = 0o755
const TIMEOUT_MS = 30_000
const SHA1_LENGTH = 40
const OLD_GIT_SHIM = 'old-git'
const USAGE_EXIT_CODE = 129
const REAL_GIT = '/usr/bin/git'

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string; remote_url: string } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	remote_url: '',
	restore_environment: undefined,
}

function in_workspace(name: string): string {
	return path.join(fixture.workspace, name)
}

async function in_repository(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git(fixture.repository_root, arguments_)
}

async function read_head(): Promise<string> {
	return await in_repository(['rev-parse', HEAD])
}

async function commit_empty(message: string): Promise<string> {
	await in_repository(['commit', '--allow-empty', '--no-verify', '-m', message])

	return await read_head()
}

// What a push leaves behind, written directly: the remote-tracking ref naming `revision`.
async function record_pushed(revision: string): Promise<void> {
	await in_repository(['update-ref', TRACKING_REFERENCE, revision])
}

function to_stdin_line(head: string, remote_oid: string): string {
	return `${MAIN_REFERENCE} ${head} ${MAIN_REFERENCE} ${remote_oid}\n`
}

// The hook writes down what git's pre-push contract handed it, then exits with `exit_code`.
async function install_hook(exit_code: number): Promise<void> {
	const script = [
		'#!/bin/sh',
		`printf '%s %s' "$1" "$2" > '${in_workspace(ARGUMENTS_FILE)}'`,
		`cat > '${in_workspace(STDIN_FILE)}'`,
		`exit ${String(exit_code)}`,
	].join('\n')

	await writeFile(path.join(in_workspace(HOOKS), 'pre-push'), `${script}\n`, {
		mode: EXECUTABLE_MODE,
	})
}

async function read_recorded(name: string): Promise<string> {
	return await readFile(in_workspace(name), 'utf8')
}

// The hooks directory is named on the repository rather than left at `.git/hooks`, so a
// `core.hooksPath` in the machine's global config cannot route the hook somewhere else.
async function create_repository(): Promise<void> {
	await git(fixture.workspace, ['init', MAIN_BRANCH, REPOSITORY])
	await git(fixture.workspace, ['init', '--bare', MAIN_BRANCH, REMOTE])
	await git(fixture.workspace, ['init', '--bare', HOOKS])
	await in_repository(['config', 'core.hooksPath', in_workspace(HOOKS)])
	// Configured rather than `remote add`ed: the unit-suite guard refuses `git remote` whole.
	await in_repository(['config', 'remote.origin.url', fixture.remote_url])
	await commit_empty('base')
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.repository_root = path.join(opened.workspace, REPOSITORY)
	fixture.remote_url = path.join(opened.workspace, REMOTE)
	await create_repository()
	process.chdir(fixture.repository_root)
	// The hook is run through the real binary rather than the unit-suite guard's `git` shim
	// (joshuafolkken/kit#3234).
	vi.stubEnv(GIT_BINARY_KEY, '')
}, TIMEOUT_MS)

afterEach(async () => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	await git_fixture_workspace.close_workspace(fixture)
})

// joshuafolkken/kit#3300: the hook runs ahead of the bounded push, so what git would hand it has to
// be handed to it here — the remote's name and URL, and the ref line on stdin.
describe('running the pre-push hook ahead of the push', () => {
	it(
		'hands the hook the remote name, its URL and a zero remote id for a new branch',
		async () => {
			await install_hook(0)
			const head = await read_head()

			await git_pre_push_hook.run()

			expect(await read_recorded(ARGUMENTS_FILE)).toBe(`origin ${fixture.remote_url}`)
			expect(await read_recorded(STDIN_FILE)).toBe(to_stdin_line(head, '0'.repeat(SHA1_LENGTH)))
		},
		TIMEOUT_MS,
	)

	it(
		'hands the hook the remote-tracking id when the branch was pushed before',
		async () => {
			await install_hook(0)
			const previous = await read_head()

			await record_pushed(previous)
			const head = await commit_empty('next')

			await git_pre_push_hook.run()

			expect(await read_recorded(STDIN_FILE)).toBe(to_stdin_line(head, previous))
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#3590: `git_spawn.with_output` defaults to a local command's budget, which would
// end the hook inside the unit suite it runs.
describe('the budget the pre-push hook runs on', () => {
	it(
		'gives the hook the budget of a suite',
		async () => {
			await install_hook(0)
			const with_output = vi.spyOn(git_spawn, 'with_output')

			await git_pre_push_hook.run()

			expect(with_output).toHaveBeenCalledWith('hook', expect.any(Array), {
				timeout_ms: SUITE_TIMEOUT_MS,
			})
		},
		TIMEOUT_MS,
	)
})

// Like git, an up-to-date branch runs no hook, and a hook that refuses stops the push before it starts.
describe('when the pre-push hook does not let the push through', () => {
	it(
		'runs no hook when the remote-tracking ref already names HEAD',
		async () => {
			await install_hook(0)
			await record_pushed(HEAD)

			await git_pre_push_hook.run()

			await expect(read_recorded(ARGUMENTS_FILE)).rejects.toThrow('ENOENT')
		},
		TIMEOUT_MS,
	)

	it(
		'fails when the hook fails',
		async () => {
			await install_hook(1)

			await expect(git_pre_push_hook.run()).rejects.toThrow('git hook exited with code 1')
		},
		TIMEOUT_MS,
	)
})

// A git older than `git hook run --to-stdin` exits 129 on the call; the shim stands in for one.
async function install_old_git(): Promise<string> {
	const shim_path = in_workspace(OLD_GIT_SHIM)
	const script = [
		'#!/bin/sh',
		`if [ "$1" = hook ]; then exit ${String(USAGE_EXIT_CODE)}; fi`,
		`exec ${REAL_GIT} "$@"`,
	].join('\n')

	await writeFile(shim_path, `${script}\n`, { mode: EXECUTABLE_MODE })

	return shim_path
}

describe('on a git that cannot run the hook ahead of the push', () => {
	it(
		'leaves the hook to the push and runs nothing itself',
		async () => {
			await install_hook(0)
			vi.stubEnv(GIT_BINARY_KEY, await install_old_git())

			await expect(git_pre_push_hook.run()).resolves.toBe(false)
			await expect(read_recorded(ARGUMENTS_FILE)).rejects.toThrow('ENOENT')
		},
		TIMEOUT_MS,
	)
})
