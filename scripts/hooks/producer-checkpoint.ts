import { canonical_command } from '#scripts/josh/josh-aliases'
import { git_argv } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { implementation_shell } from './implementation-shell'

// **A no-filing producer checkpoints its own work branch** (joshuafolkken/kit#9091). A producer is
// replaced when its context runs long or an edit is refused, and an uncommitted worktree cannot be
// handed to the next one. So inside its own worktree it may run `josh git:checkpoint` (stage, commit
// a `WIP checkpoint:` subject with lefthook skipped, point `wip/<name>` at it; `git-checkpoint.ts`)
// and merge the work branch or main in. Nothing leaves the tree: push, `gh`, a global option that
// moves git elsewhere, or any other write keeps the refusal (`implementation-shell.ts`), and the ship
// refuses a checkpoint tip (`git-checkpoint-tip.ts`).
const CHECKPOINT_COMMAND = 'git:checkpoint'
const SUBSTITUTION = /\$\(|`/u

function has_globals(segment: string): boolean {
	const words = git_argv.words_of(segment)

	return git_argv.globals_of(words.slice(words.indexOf('git') + 1)).length > 0
}

function is_merge(segment: string): boolean {
	return git_argv.parse(segment)?.subcommand === 'merge' && !has_globals(segment)
}

function is_checkpoint_command(segment: string): boolean {
	const call = git_argv.program_of(segment)
	if (call?.name !== 'josh') return false

	return canonical_command(call.args[0] ?? '') === CHECKPOINT_COMMAND
}

function is_checkpoint_segment(segment: string): boolean {
	return is_checkpoint_command(segment) || is_merge(segment)
}

function is_passing_segment(segment: string): boolean {
	if (is_checkpoint_segment(segment)) return true

	return git_argv.program_of(segment)?.name !== 'cd' && !implementation_shell.is_unsafe(segment)
}

// A command passes when every segment is the checkpoint, a merge, or one the shell rule passes alone;
// a heredoc, a substitution or a `cd` beside it is not read, so it keeps the refusal.
function allows(command: string): boolean {
	if (time_shell.has_heredoc(command) || SUBSTITUTION.test(command)) return false
	const segments = shell_segments.quote_aware_commands_of(command)

	const has_checkpoint = segments.some((segment) => is_checkpoint_segment(segment))

	return has_checkpoint && segments.every((segment) => is_passing_segment(segment))
}

const producer_checkpoint = { allows }

export { producer_checkpoint }
