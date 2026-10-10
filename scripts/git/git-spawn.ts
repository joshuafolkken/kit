import { GIT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { git_utilities } from './constants'
import {
	create_spawn_error,
	get_exit_code,
	has_timed_out,
	TIMEOUT_EXIT_CODE,
} from './git-execa-error'
import { PUSH_TIMEOUT_MS } from './git-push-transport'
import { git_ssh_keepalive } from './git-ssh-keepalive'

// The one place the ordinary git commands are spawned from. It sits in a
// module of its own rather than inside `git-command.ts` so that a second command module —
// `git-worktree.ts` — can read it without importing the first. `read` is what resolves the git binary
// and turns a non-zero exit into an error, and a second spawn helper beside it would be the clone
// `CLAUDE.md` prohibits, so a new caller imports this one instead of growing its own.
//
// **`git-push-transport.ts` is the one deliberate exception among the command modules** and is not a
// second helper of this kind: a push needs a transport-fault retry that no other command has, so it
// spawns git itself. The timeout it carries is shared here by `read_remote` / `with_output_remote`. Those two files are the spawn sites of the ordinary command
// modules — the claim stops there. A synchronous caller goes through `git-spawn-sync.ts`, the same
// binary resolution with a result instead of an exception. Other parts of
// this package spawn git for their own purposes (`scripts/run/progress/run-progress-clock.ts`,
// `scripts/git/git-fixture-workspace.ts`), and an audit of how the git binary is resolved has to read
// those too.

// Bounded by `GIT_TIMEOUT_MS` unless the caller says otherwise, as the synchronous `git_spawn_sync.run`
// is: a local git that never answers ends the call instead of holding an unattended run open.
async function read(
	arguments_: Array<string>,
	timeout_ms: number = GIT_TIMEOUT_MS,
): Promise<string> {
	const git_cmd = git_utilities.get_git_command_for_spawn()
	// execa runs the binary directly with an argument array and no `shell` option, so CLI
	// args cannot break out of a shell sandbox; the git command and args are internally
	// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
	const { stdout } = await execa(git_cmd, arguments_, { timeout: timeout_ms }) // NOSONAR

	return stdout.trimEnd()
}

// The budget for a git call that talks to the remote — `fetch` and `pull`.
// `read` and `with_output` once waited without end, and a `git fetch --prune` under `josh main:sync`
// sat on a dead ssh connection for 37 minutes, stalling the unattended backlog driver whose merge step
// runs it. Their default now is a local command's, far too short for a transfer, so a remote call
// still takes this one. The push's budget is reused rather than a second number chosen: both transfer
// objects over the same transport, and that one is already read off what a healthy transfer costs here.
const REMOTE_TIMEOUT_MS = PUSH_TIMEOUT_MS
const MS_PER_SECOND = 1000

// A budget kill is reported as a timeout, never as whatever the killed process printed first, and
// `cause` carries the same `TIMEOUT_EXIT_CODE` a timed-out push does. Unlike the push it is not
// retried here: what the issue needed is that the wait ends, and a failure then surfaces to the
// caller — `run:merge` raises a failed `main:sync` — instead of a second budget doubling the wait.
function to_budget_error(command: string, error: unknown, timeout_ms: number): Error {
	if (!has_timed_out(error)) return create_spawn_error(command, get_exit_code(error))

	const seconds = String(Math.round(timeout_ms / MS_PER_SECOND))

	return new Error(`git ${command} timed out after ${seconds}s`, {
		cause: { exit_code: TIMEOUT_EXIT_CODE },
	})
}

interface RemoteOptions {
	stdio?: 'inherit'
	timeout: number
	env: Record<string, string>
}

// One remote call, bounded and kept alive. execa kills git on the budget; the ssh keepalive is what
// makes ssh — which git does not kill with itself — exit on a dead connection as well.
async function spawn_remote(arguments_: Array<string>, options: RemoteOptions): Promise<string> {
	const git_cmd = git_utilities.get_git_command_for_spawn()

	try {
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		const { stdout } = await execa(git_cmd, arguments_, options) // NOSONAR

		return typeof stdout === 'string' ? stdout.trimEnd() : ''
	} catch (error) {
		throw to_budget_error(arguments_[0] ?? '', error, options.timeout)
	}
}

// `read` for a call that reaches the remote. The budget is a parameter only so a test can hold it to
// seconds; every production caller takes the default.
async function read_remote(
	arguments_: Array<string>,
	timeout_ms: number = REMOTE_TIMEOUT_MS,
): Promise<string> {
	return await spawn_remote(arguments_, {
		timeout: timeout_ms,
		env: await git_ssh_keepalive.to_environment(),
	})
}

// `with_output` for a call that reaches the remote — the output stays on the terminal, as a pull's
// progress and a credential prompt need.
async function with_output_remote(command: string, arguments_list: Array<string>): Promise<void> {
	await spawn_remote([command, ...arguments_list], {
		stdio: 'inherit',
		timeout: REMOTE_TIMEOUT_MS,
		env: await git_ssh_keepalive.to_environment(),
	})
}

// `config_options` are `-c <key>=<value>` pairs, which git reads only ahead of the command name and
// which last for this one call — nothing is written into anyone's git configuration.
//
// `timeout_ms` defaults to a local command's budget. A command that runs hooks — a commit, a merge,
// `git hook run` — is not one, and names the longer budget itself.
interface OutputOptions {
	config_options?: ReadonlyArray<string>
	timeout_ms?: number
}

async function with_output(
	command: string,
	arguments_list: Array<string>,
	options: OutputOptions = {},
): Promise<void> {
	const { config_options = [], timeout_ms = GIT_TIMEOUT_MS } = options
	const git_command_bin = git_utilities.get_git_command_for_spawn()
	const spawn_arguments = [...config_options, command, ...arguments_list]

	try {
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		await execa(git_command_bin, spawn_arguments, { stdio: 'inherit', timeout: timeout_ms }) // NOSONAR
	} catch (error) {
		throw to_budget_error(command, error, timeout_ms)
	}
}

const git_spawn = {
	read,
	read_remote,
	with_output,
	with_output_remote,
}

export { git_spawn }
