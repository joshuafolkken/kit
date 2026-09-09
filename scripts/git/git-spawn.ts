import { execa } from 'execa'
import { git_utilities } from './constants'
import { create_spawn_error, get_exit_code } from './git-execa-error'

// The one place the ordinary git commands are spawned from (joshuafolkken/kit#1640). It sits in a
// module of its own rather than inside `git-command.ts` so that a second command module —
// `git-worktree.ts` — can read it without importing the first. `read` is what resolves the git binary
// and turns a non-zero exit into an error, and a second spawn helper beside it would be the clone
// `CLAUDE.md` prohibits, so a new caller imports this one instead of growing its own.
//
// **`git-push-transport.ts` is the one deliberate exception among the command modules** and is not a
// second helper of this kind: a push needs a timeout and a transport-fault retry that no other
// command has, so it spawns git itself. Those two files are the spawn sites of the ordinary command
// modules — the claim stops there. Other parts of this package spawn git for their own purposes
// (`scripts/run/run-progress-clock.ts`, `scripts/propagate/propagate-git.ts`,
// `scripts/doctor/doctor-io.ts`, `scripts/git/git-fixture-workspace.ts`), and an audit of how the git
// binary is resolved has to read those too.

async function read(arguments_: Array<string>): Promise<string> {
	const git_cmd = git_utilities.get_git_command_for_spawn()
	// execa runs the binary directly with an argument array and no `shell` option, so CLI
	// args cannot break out of a shell sandbox; the git command and args are internally
	// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
	const { stdout } = await execa(git_cmd, arguments_) // NOSONAR

	return stdout.trimEnd()
}

async function with_output(command: string, arguments_list: Array<string>): Promise<void> {
	const git_command_bin = git_utilities.get_git_command_for_spawn()

	try {
		// execa runs the binary directly with an argument array and no `shell` option, so CLI
		// args cannot break out of a shell sandbox; the git command and args are internally
		// controlled, never untrusted input. tssecurity:S8705 is a false positive here.
		await execa(git_command_bin, [command, ...arguments_list], { stdio: 'inherit' }) // NOSONAR
	} catch (error) {
		throw create_spawn_error(command, get_exit_code(error))
	}
}

const git_spawn = {
	read,
	with_output,
}

export { git_spawn }
