import { execa } from 'execa'
import { git_utilities } from './constants'

// The ssh environment every git network call runs under. It began inside
// `git-push-transport.ts` as the push's own, and moved here when the fetch
// and pull of `josh main:sync` turned out to need the same thing: a dead connection under a `git
// fetch` was waited on for 37 minutes, stalling the unattended backlog driver behind it.
//
// SSH's own liveness probe: three unanswered checks 15 seconds apart, so a connection that dies
// mid-transfer is noticed in about 45 seconds instead of waiting on the TCP default. The caller's
// timeout bounds the damage either way; this is what makes the common case fail in seconds rather
// than sit out the whole budget — and, because ssh exits on its own, it is also what leaves no ssh
// behind: git does not kill its transport child when it is itself killed on a timeout.
const SSH_KEEPALIVE_OPTIONS = '-o ServerAliveInterval=15 -o ServerAliveCountMax=3'
const SSH_COMMAND_VARIABLE = 'GIT_SSH_COMMAND'
const SSH_LEGACY_VARIABLE = 'GIT_SSH'
const KEEPALIVE_SSH_COMMAND = `ssh ${SSH_KEEPALIVE_OPTIONS}`
const SSH_COMMAND_CONFIG_KEY = 'core.sshCommand'

// Whatever already decides how ssh is invoked, or an empty string when nothing does. git reads three
// sources in this order — `GIT_SSH_COMMAND`, `core.sshCommand`, then the legacy `GIT_SSH` — and the
// last one has to be asked as well precisely because it loses: setting `GIT_SSH_COMMAND` on top of a
// `GIT_SSH=plink.exe` outranks it, so git would run an ssh binary the user did not choose.
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
// platform — each of them exits on a usage error rather than connecting. Setting the variable while
// `core.sshCommand` is configured is the same mistake from the other side: the environment wins, so
// a per-repository key would be silently replaced by a plain `ssh`.
//
// What those users lose is the keepalive, not the fix: the caller's timeout still bounds the call,
// and `ServerAliveInterval` belongs in their own ssh config where it applies to every tool they run.
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

// The `env` a git network spawn passes to execa: the keepalive command, or nothing at all.
async function to_environment(): Promise<Record<string, string>> {
	const should_keep_alive = !(await has_configured_ssh_command())

	return should_keep_alive ? { [SSH_COMMAND_VARIABLE]: KEEPALIVE_SSH_COMMAND } : {}
}

const git_ssh_keepalive = {
	to_environment,
}

export { git_ssh_keepalive }
export { KEEPALIVE_SSH_COMMAND, SSH_COMMAND_VARIABLE, SSH_LEGACY_VARIABLE }
