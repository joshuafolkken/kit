import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BINARY_KEY } from './constants'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { git_spawn } from './git-spawn'
import { SSH_COMMAND_VARIABLE } from './git-ssh-keepalive'

// joshuafolkken/kit#2942: `josh main:sync` ran `git fetch --prune` over a dead ssh connection and did
// not return for 37 minutes, stalling the unattended backlog driver behind it. The stand-in for that
// connection is an ssh command that never answers: it records git's pid and its own, then sleeps far
// past the budget, so a fetch without a timeout would sit out the whole sleep.

const WORKSPACE_PREFIX = 'kit-git-spawn-'
const REPOSITORY = 'repository'
const UPSTREAM = 'upstream'
const PID_FILE = 'ssh-pids'
const BUDGET_MS = 1000
const HANG_SECONDS = 60
const MS_PER_SECOND = 1000
// Room for git to start and for execa to reap it after the kill — far under the hang, which is what
// the elapsed-time assertion has to tell apart.
const REAP_ALLOWANCE_MS = 10_000
const TIMEOUT_MS = 30_000
const FETCH_PRUNE = ['fetch', '--prune']
const EMPTY_COMMIT = ['commit', '--allow-empty', '-m']

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string; ssh_pid: number | undefined } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
	ssh_pid: undefined,
}

// `kill(pid, 0)` delivers nothing and only asks whether the process exists.
function is_alive(pid: number): boolean {
	try {
		process.kill(pid, 0)

		return true
	} catch {
		return false
	}
}

// git runs the ssh command through `sh -c`, so `$PPID` is git and `$$` is the shell `exec` turns into
// the sleep.
function stub_hanging_ssh(): string {
	const pid_file = path.join(fixture.workspace, PID_FILE)

	vi.stubEnv(
		SSH_COMMAND_VARIABLE,
		`echo $PPID $$ > '${pid_file}'; exec sleep ${String(HANG_SECONDS)}; :`,
	)

	return pid_file
}

async function read_pids(pid_file: string): Promise<Array<number>> {
	const content = await readFile(pid_file, 'utf8')
	const pids = content.trim().split(' ').map(Number)

	fixture.ssh_pid = pids[1]

	return pids
}

// Written with `git config` rather than `clone` / `remote add`: the unit suite's network guard refuses
// both subcommands outright, and the remote here is a local path or a stand-in that never connects.
async function set_origin(url: string): Promise<void> {
	await git(fixture.repository_root, ['config', 'remote.origin.url', url])
	await git(fixture.repository_root, [
		'config',
		'remote.origin.fetch',
		'+refs/heads/*:refs/remotes/origin/*',
	])
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	Object.assign(fixture, opened, {
		repository_root: path.join(opened.workspace, REPOSITORY),
		ssh_pid: undefined,
	})
	await git(opened.workspace, ['init', MAIN_BRANCH, UPSTREAM])
	await git(path.join(opened.workspace, UPSTREAM), [...EMPTY_COMMIT, 'base'])
	await git(opened.workspace, ['init', MAIN_BRANCH, REPOSITORY])
	await set_origin(path.join(opened.workspace, UPSTREAM))
	process.chdir(fixture.repository_root)
	// The fetch here is the subject and reaches only a local upstream, which the unit-suite guard's `git`
	// shim cannot tell from a real remote — so the spawn runs the real binary (joshuafolkken/kit#3234).
	vi.stubEnv(GIT_BINARY_KEY, '')
}, TIMEOUT_MS)

// The stand-in ssh is the one process git leaves behind — which is the keepalive's to end in
// production, and this suite's to end here.
afterEach(async () => {
	vi.unstubAllEnvs()
	if (fixture.ssh_pid !== undefined && is_alive(fixture.ssh_pid)) process.kill(fixture.ssh_pid)
	await git_fixture_workspace.close_workspace(fixture)
})

describe.skipIf(process.platform === 'win32')('a remote git call is bounded', () => {
	it(
		'fails a fetch that never hears back as a timeout within the budget',
		async () => {
			const pid_file = stub_hanging_ssh()

			await set_origin('ssh://example.invalid/repo')

			const started = Date.now()

			await expect(git_spawn.read_remote(FETCH_PRUNE, BUDGET_MS)).rejects.toThrow(
				`git fetch timed out after ${String(BUDGET_MS / MS_PER_SECOND)}s`,
			)
			expect(Date.now() - started).toBeLessThan(BUDGET_MS + REAP_ALLOWANCE_MS)
			expect(Date.now() - started).toBeLessThan(HANG_SECONDS * MS_PER_SECOND)

			const [git_pid = 0] = await read_pids(pid_file)

			expect(is_alive(git_pid)).toBe(false)
		},
		TIMEOUT_MS,
	)

	it(
		'fetches as before when the remote answers',
		async () => {
			await git(path.join(fixture.workspace, UPSTREAM), [...EMPTY_COMMIT, 'next'])

			await git_spawn.read_remote(FETCH_PRUNE, BUDGET_MS * HANG_SECONDS)

			expect(await git(fixture.repository_root, ['rev-parse', 'origin/main'])).toBe(
				await git(path.join(fixture.workspace, UPSTREAM), ['rev-parse', 'HEAD']),
			)
		},
		TIMEOUT_MS,
	)
})
