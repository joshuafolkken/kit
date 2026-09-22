import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `git-force` row of `delivered-rules.ts`
// (joshuafolkken/kit#2120). Group 1 of the three Bash-string gaps: a force push or a branch delete
// spelled in a way the `deny` glob cannot express.
//
// **The deny list stops the spellings a glob can reach and no others.** `Bash(git push *--force*)` and
// `Bash(git push * -f)` catch the flag written after the arguments; `Bash(git branch -d*)` /
// `Bash(git branch -D*)` catch a delete. But a combined short cluster (`git push -uf`), a `git -C
// <path>` prefix, and the colon-form delete (`git push origin :branch`) all pass every entry, because
// none of them puts the literal the glob keys on where the glob looks (`operating-rules.md`). Reading
// the argv is what makes the judgement independent of the spelling.
//
// **It fires on every occurrence, not once per run.** A force push is destructive every time it is
// issued, so refused-once-and-free-after would put the second one back on the run's self-restraint —
// the disposition `run-tail.ts` and `filing-cap.ts` take for the same reason.

// A force push. The long forms all open with `--force` (`--force`, `--force-with-lease[=ref]`,
// `--force-if-includes`); `-f` and any cluster carrying `f` are the short forms; a bare `--delete` and
// a cluster carrying `d` are the delete flags; and a refspec carries the force or delete in its own
// spelling — a leading `+` forces the update (`+main:main`, `+:branch`) and an empty source side
// deletes (`:branch`). Both open the refspec with a character the deny list cannot match as a literal.
const FORCE_LONG_PREFIX = '--force'
const DELETE_LONG = '--delete'
const PUSH_SHORT_LETTERS = 'fd'
const FORCE_OR_DELETE_REFSPEC = /^[+:]/u

function is_force_or_delete_push(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument) =>
			argument.startsWith(FORCE_LONG_PREFIX) ||
			argument === DELETE_LONG ||
			git_argv.short_cluster_has(argument, PUSH_SHORT_LETTERS) ||
			FORCE_OR_DELETE_REFSPEC.test(argument),
	)
}

// A branch delete: `--delete`, `-d` (delete), or `-D` (force delete), including a cluster carrying
// either letter. `-m` (rename), `-a` / `-r` (list) and `-f` (force-create) are deliberately not here —
// this rule is the delete the deny glob misses, not every branch mutation.
const BRANCH_DELETE_LETTERS = 'dD'

function is_branch_delete(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument) =>
			argument === DELETE_LONG || git_argv.short_cluster_has(argument, BRANCH_DELETE_LETTERS),
	)
}

const PUSH_SUBCOMMAND = 'push'
const BRANCH_SUBCOMMAND = 'branch'

function is_destructive_segment(segment: string): boolean {
	const call = git_argv.parse(segment)

	if (call === undefined) return false

	if (call.subcommand === PUSH_SUBCOMMAND) return is_force_or_delete_push(call.args)

	return call.subcommand === BRANCH_SUBCOMMAND && is_branch_delete(call.args)
}

// A shell line carries several commands, so each segment is judged on its own — a `git push --force`
// quoted inside another command's argument is read as the write it is not, exactly as every other
// trigger in this directory reads its own.
function is_force_or_delete(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_destructive_segment(segment))
}

// The instruction in the shape a refusal can carry: what the command does, why the deny list did not
// stop it, and the one route left. There is no "safe reissue" the way a backgrounded push is for
// `run-tail` — a force push and a branch delete are Tier C, so the honest next move is a person's, in
// their own terminal.
const GIT_FORCE_REASON =
	'⛔ force push or branch delete: this rewrites or removes shared history, which is Tier C and needs ' +
	'explicit current-turn user instruction — never an AI decision, even to fix a problem you caused ' +
	'(`prompts/collaboration-workflow/operating-rules.md`). The `.claude/settings.json` deny list ' +
	'matches globs, so it misses this spelling: a combined short cluster (`git push -uf`), a `git -C ' +
	'<path>` prefix, and the colon-form delete (`git push origin :branch`) all pass it. This row reads ' +
	'the argv instead, so the spelling does not matter. For an ordinary push use `pnpm josh git`; a ' +
	"force push, a `git push --delete` / `:branch`, or a `git branch -d` / `-D` is the user's to run in " +
	'their own terminal. **This rule fires on every occurrence, not once per run.**'

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` returns true so it refuses every
// occurrence; it declares no `keeps` — not force-pushing is the absence of a call, not a call, so the
// row is reported unmeasured rather than scored on an act that does not exist (`filing-cap.ts`).
const ROW = {
	id: 'git-force',
	is_trigger: bash_triggers.on_bash_command(is_force_or_delete),
	reason: GIT_FORCE_REASON,
	decide: (): boolean => true,
}

const git_force = {
	GIT_FORCE_REASON,
	ROW,
	is_branch_delete,
	is_force_or_delete,
	is_force_or_delete_push,
}

export { git_force }
