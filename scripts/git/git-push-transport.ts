import { execa } from 'execa'
import { git_utilities } from './constants'
import { create_spawn_error, get_exit_code, has_timed_out } from './git-execa-error'

const MS_PER_SECOND = 1000

// The budget for one `git push`, and the reason a push can no longer wait without end
// (joshuafolkken/kit#1251). Measured on PR #1244: the commit itself took 0.6 seconds and the push
// then sat silent for 8 minutes 13 seconds before it was found by hand and killed — about 9 minutes
// 50 seconds of a 72-minute run, with no way while waiting to tell a stalled push from a slow one.
// `execa` has always accepted a `timeout`; the push path never passed one, which left it the single
// unbounded network call in this directory beside `GH_REQUEST_TIMEOUT_MS`.
//
// **It sits at that same layer, and is deliberately larger.** That budget covers one REST request;
// a push transfers objects, so this number is read off what a healthy push actually costs here — 22
// seconds on the manual re-run that finally succeeded, 33 seconds on PR #1247. 120 is roughly four
// times the slower of the two, which leaves room for a first push of a large branch while staying
// far under the 6 minutes 45 seconds the hang had already reached when it was noticed.
//
// **It bounds one push, not one command.** A push killed on the budget is retried exactly once, and
// `git_command.push` may then fall back to a `--set-upstream` push that is itself bounded and
// retried — so a `josh git` that hits every one of those waits takes longer than two budgets.
//
// **Time spent at a credential prompt counts against it.** With `stdio: 'inherit'` an encrypted key
// with no agent behind it prompts on the inherited terminal, and the budget does not know the
// difference between waiting on a remote and waiting on a person. Two minutes is a generous window
// for typing a passphrase you were just asked for, and the failure names the command to re-run.
const PUSH_TIMEOUT_SECONDS = 120
const PUSH_TIMEOUT_MS = PUSH_TIMEOUT_SECONDS * MS_PER_SECOND
const PUSH_TIMEOUT_LABEL = `${String(PUSH_TIMEOUT_SECONDS)}s`

// What a push killed on the budget is labelled with. "Nobody ever got an answer" and "the remote
// said no" are different diagnoses, and only the first one is worth retrying.
const PUSH_TIMEOUT_MESSAGE = 'git push timed out'

// A timeout has no exit code — the process was killed rather than allowed to exit — so `cause` says
// so in the slot every other git failure puts a number in. `is_upstream_not_set_error` compares
// against '128', which this can never equal, so a timed-out bare push is never mistaken for a
// missing upstream and retried as `--set-upstream`.
const PUSH_TIMEOUT_EXIT_CODE = 'timeout'

// SSH's own liveness probe: three unanswered checks 15 seconds apart, so a connection that dies
// mid-transfer is noticed in about 45 seconds instead of waiting on the TCP default. The budget
// above bounds the damage either way; this is what makes the common case fail in seconds rather
// than sit out the whole budget.
const SSH_KEEPALIVE_OPTIONS = '-o ServerAliveInterval=15 -o ServerAliveCountMax=3'
const SSH_COMMAND_VARIABLE = 'GIT_SSH_COMMAND'
const SSH_LEGACY_VARIABLE = 'GIT_SSH'
const KEEPALIVE_SSH_COMMAND = `ssh ${SSH_KEEPALIVE_OPTIONS}`
const SSH_COMMAND_CONFIG_KEY = 'core.sshCommand'
const PUSH_SUBCOMMAND = 'push'

// Whatever already decides how ssh is invoked, or an empty string when nothing does. git reads three
// sources in this order — `GIT_SSH_COMMAND`, `core.sshCommand`, then the legacy `GIT_SSH` — and the
// last one has to be asked as well precisely because it loses: setting `GIT_SSH_COMMAND` on top of a
// `GIT_SSH=plink.exe` outranks it, so the push would run an ssh binary the user did not choose.
function to_environment_value(name: string): string {
	return process.env[name]?.trim() ?? ''
}

function to_configured_ssh_command(): string {
	const from_command = to_environment_value(SSH_COMMAND_VARIABLE)

	return from_command === '' ? to_environment_value(SSH_LEGACY_VARIABLE) : from_command
}

// Whether any of those three sources answered. **A hit means hands off entirely.**
//
// Appending the options to a command someone else chose is not safe, because they are OpenSSH's:
// `plink` and `TortoiseGitPlink` are supported ssh commands on the platform `get_git_command_for_spawn`
// goes out of its way to handle, and a wrapper script with a fixed argument list is common on any
// platform — each of them exits on a usage error rather than pushing. Setting the variable while
// `core.sshCommand` is configured is the same mistake from the other side: the environment wins, so
// a per-repository key would be silently replaced by a plain `ssh`.
//
// What those users lose is the keepalive, not the fix: the budget above still bounds their push, and
// `ServerAliveInterval` belongs in their own ssh config where it applies to every tool they run.
async function has_configured_ssh_command(): Promise<boolean> {
	if (to_configured_ssh_command() !== '') return true

	try {
		const git_command_bin = git_utilities.get_git_command_for_spawn()
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		const { stdout } = await execa(git_command_bin, ['config', '--get', SSH_COMMAND_CONFIG_KEY]) // NOSONAR

		return stdout.trim() !== ''
	} catch {
		// `git config --get` exits 1 when the key is unset, which is the answer rather than a failure.
		return false
	}
}

interface PushOptions {
	stdio: 'inherit'
	timeout: number
	env: Record<string, string>
}

async function to_push_options(): Promise<PushOptions> {
	const should_keep_alive = !(await has_configured_ssh_command())

	return {
		stdio: 'inherit',
		timeout: PUSH_TIMEOUT_MS,
		env: should_keep_alive ? { [SSH_COMMAND_VARIABLE]: KEEPALIVE_SSH_COMMAND } : {},
	}
}

// One attempt. `true` means the budget killed it — the only failure worth trying again; every other
// failure is git's own answer and is thrown here, so the caller below never sees it.
async function did_push_time_out(arguments_list: Array<string>): Promise<boolean> {
	const git_command_bin = git_utilities.get_git_command_for_spawn()
	const options = await to_push_options()

	try {
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		await execa(git_command_bin, [PUSH_SUBCOMMAND, ...arguments_list], options) // NOSONAR

		return false
	} catch (error) {
		if (has_timed_out(error)) return true

		throw create_spawn_error(PUSH_SUBCOMMAND, get_exit_code(error))
	}
}

function to_manual_command(arguments_list: Array<string>): string {
	return ['git', PUSH_SUBCOMMAND, ...arguments_list].join(' ')
}

function to_retry_notice(arguments_list: Array<string>): string {
	return `${PUSH_TIMEOUT_MESSAGE} after ${PUSH_TIMEOUT_LABEL} — retrying once: ${to_manual_command(arguments_list)}`
}

// Both halves of the report matter. The count says the wait was bounded twice rather than once, and
// the command is what makes the failure actionable without reconstructing the arguments — the
// `--set-upstream` form in particular is not what a person would type from memory.
function create_timeout_error(arguments_list: Array<string>): Error {
	const message = `${PUSH_TIMEOUT_MESSAGE} twice (${PUSH_TIMEOUT_LABEL} each). Re-run it by hand: ${to_manual_command(arguments_list)}`

	return new Error(message, { cause: { exit_code: PUSH_TIMEOUT_EXIT_CODE } })
}

// One push, bounded and retried once — and **only** on a timeout. A push the remote rejected (a
// stale branch, a blocked hook, no upstream) answers the same way every time, so retrying it would
// buy a second wait to reach an identical failure; a hang is the one outcome a second attempt has
// been observed to clear, which is what the manual re-run on PR #1244 did in 22 seconds.
async function push(arguments_list: Array<string>): Promise<void> {
	if (!(await did_push_time_out(arguments_list))) return

	console.warn(to_retry_notice(arguments_list))

	if (!(await did_push_time_out(arguments_list))) return

	throw create_timeout_error(arguments_list)
}

const git_push_transport = {
	push,
}

export { git_push_transport }
export {
	KEEPALIVE_SSH_COMMAND,
	PUSH_TIMEOUT_MESSAGE,
	PUSH_TIMEOUT_MS,
	SSH_COMMAND_VARIABLE,
	SSH_LEGACY_VARIABLE,
}
