import { git_checkpoint_tip } from '#scripts/git/git-checkpoint-tip'
import { git_argv } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { implementation_shell } from './implementation-shell'

// **A no-filing producer checkpoints its own work branch** (joshuafolkken/kit#9091). A producer is
// replaced when its context runs long or an edit is refused, and an uncommitted worktree cannot be
// handed to the next one. So inside its own worktree it may stage, commit a `WIP checkpoint:` subject
// (lefthook skipped), merge the work branch or main in, and point a `wip/<name>` ref at its tip.
// Nothing leaves the tree: push, `gh`, a global option that moves git elsewhere, or any other write
// keeps the refusal (`implementation-shell.ts`), and a checkpoint tip is refused by the ship
// and the gate (`git-checkpoint-tip.ts`).
const WORK_REF = /^wip\/[\w./-]+$/u
const BRANCH_FLAGS: ReadonlySet<string> = new Set(['-f', '--force'])
const MESSAGE_FLAGS: ReadonlySet<string> = new Set(['-m', '--message'])
const UNQUOTE = /^(['"])([\s\S]*)\1$/u
const SUBSTITUTION = /\$\(|`/u

function unquoted(word: string): string {
	return word.replace(UNQUOTE, '$2')
}

function is_checkpoint_commit(args: ReadonlyArray<string>): boolean {
	const flag = args.findIndex((word) => MESSAGE_FLAGS.has(word))
	if (flag === -1) return false

	return git_checkpoint_tip.is_checkpoint_subject(unquoted(args[flag + 1] ?? ''))
}

// `git branch [-f] wip/<name> [start]`: the work ref only, never a delete or rename.
function is_work_reference(args: ReadonlyArray<string>): boolean {
	const [name = '', start = '', ...rest] = args.filter((word) => !BRANCH_FLAGS.has(word))

	return rest.length === 0 && WORK_REF.test(name) && !start.startsWith('-')
}

const CHECKPOINT_FORMS: Readonly<Record<string, (args: ReadonlyArray<string>) => boolean>> = {
	add: () => true,
	commit: is_checkpoint_commit,
	merge: () => true,
	branch: is_work_reference,
}

function has_globals(segment: string): boolean {
	const words = git_argv.words_of(segment)

	return git_argv.globals_of(words.slice(words.indexOf('git') + 1)).length > 0
}

function is_checkpoint_segment(segment: string): boolean {
	const call = git_argv.parse(segment)
	if (call?.subcommand === undefined || has_globals(segment)) return false
	const form = CHECKPOINT_FORMS[call.subcommand]

	return form?.(call.args) === true
}

function is_passing_segment(segment: string): boolean {
	if (is_checkpoint_segment(segment)) return true

	return git_argv.program_of(segment)?.name !== 'cd' && !implementation_shell.is_unsafe(segment)
}

// A command passes when every segment is a checkpoint git call or one the shell rule passes alone;
// a heredoc, a substitution or a `cd` beside it is not read, so it keeps the refusal.
function allows(command: string): boolean {
	if (time_shell.has_heredoc(command) || SUBSTITUTION.test(command)) return false
	const segments = shell_segments.quote_aware_commands_of(command)

	const has_checkpoint = segments.some((segment) => is_checkpoint_segment(segment))

	return has_checkpoint && segments.every((segment) => is_passing_segment(segment))
}

const producer_checkpoint = { allows }

export { producer_checkpoint }
