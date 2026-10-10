import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `worktree-mutation` row of `delivered-rules.ts`.
// Group 2 of the three Bash-string gaps: a working-tree change made outside
// the authorized routes.
//
// **The deny list does not cover these at all.** `git checkout -- <path>` and `git restore <path>`
// discard uncommitted work, and `git stash` mutates a stack every work tree of the repository shares —
// none of the three is a deny entry, so the prohibition lived only in prose (`operating-rules.md`).
//
// **Authorized stash calls are told apart by the message, not by the launcher.** The Issue's premise —
// that every authorized caller is node-routed and so invisible here — does not hold: at least eight
// distributed flows (`fullrun`, `halfrun`, `backlogrun`, `upstream-interrupt`, `latest-gate`,
// `plan-comment`, …) push with a **raw** `git stash push -u -m "<message>"`. The message is what makes
// that stash findable and poppable by `pnpm josh stash:pop`, which is the whole of `operating-rules.md`'s
// safety argument; the forms it warns against are the *positional/bare* ones. So `git stash push -m`
// (with or without `-u`) and the read-only `git stash list` / `show` pass, and everything else — bare
// `git stash`, a message-less push, `pop` / `apply` / `drop` / `save` / `clear` — is refused.
//
// **The refusal names the way on for a handed-over stash.** joshuafolkken/kit#3630's plan restored a
// stash with `git stash apply`, and the lane parked on how to apply it instead of popping by message;
// the reason now says the substitution is the run's own to make (joshuafolkken/kit#3648).
//
// **It fires on every occurrence**, for the reason `git-force.ts` does: discarding the working tree is
// destructive each time it is issued.

const CHECKOUT_SUBCOMMAND = 'checkout'
const RESTORE_SUBCOMMAND = 'restore'
const STASH_SUBCOMMAND = 'stash'

// `git checkout -- <path>` discards the working-tree copy of a path. The `--` separator is what marks
// the pathspec form; `git checkout <branch>` and `git checkout -b <name>` carry no `--` and are left
// alone.
const PATHSPEC_SEPARATOR = '--'

function is_worktree_checkout(args: ReadonlyArray<string>): boolean {
	return args.includes(PATHSPEC_SEPARATOR)
}

// `git restore <path>` discards working-tree changes. `--staged` / `-S` alone is an index restore —
// that is the `index-mutation` row's (`index-guard.ts`), so a pure index restore is not claimed by two
// rows. Anything touching the worktree (the default, or an explicit `--worktree` / `-W`) is this row's.
const STAGED_LONG = '--staged'
const STAGED_LETTER = 'S'
const WORKTREE_LONG = '--worktree'
const WORKTREE_LETTER = 'W'

function touches_worktree(args: ReadonlyArray<string>): boolean {
	const is_staged = args.some(
		(argument) => argument === STAGED_LONG || git_argv.short_cluster_has(argument, STAGED_LETTER),
	)
	const is_worktree = args.some(
		(argument) =>
			argument === WORKTREE_LONG || git_argv.short_cluster_has(argument, WORKTREE_LETTER),
	)

	return !is_staged || is_worktree
}

// A stash `push` carrying a message is the authorized form. `-m` / `--message` / `--message=…`, or a
// short cluster carrying `m`, all count.
const PUSH_STASH = 'push'
const MESSAGE_LONG = '--message'
const MESSAGE_SHORT_LETTER = 'm'
const READ_ONLY_STASH: ReadonlySet<string> = new Set(['list', 'show'])

function has_message(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument) =>
			argument === MESSAGE_LONG ||
			argument.startsWith(`${MESSAGE_LONG}=`) ||
			git_argv.short_cluster_has(argument, MESSAGE_SHORT_LETTER),
	)
}

// `args[0]` is the stash subcommand — `push`, `pop`, `list`, … — or `undefined` for a bare `git stash`,
// which is a message-less push and therefore unauthorized.
function is_unauthorized_stash(args: ReadonlyArray<string>): boolean {
	const [stash_subcommand, ...rest] = args

	if (stash_subcommand === undefined) return true
	if (READ_ONLY_STASH.has(stash_subcommand)) return false
	if (stash_subcommand === PUSH_STASH) return !has_message(rest)

	return true
}

// `git clean` deletes untracked files, which no commit can bring back. It
// refuses to act without a force (`clean.requireForce`), so a force — `--force`, or a cluster carrying
// `f` — is what marks the destructive call; `git clean -n` is a dry run and passes.
const CLEAN_SUBCOMMAND = 'clean'
const FORCE_LONG = '--force'
const FORCE_LETTER = 'f'

function is_forced_clean(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument) => argument === FORCE_LONG || git_argv.short_cluster_has(argument, FORCE_LETTER),
	)
}

// Each subcommand this row judges, with the predicate that reads its arguments.
const JUDGED_SUBCOMMANDS: ReadonlyMap<string, (args: ReadonlyArray<string>) => boolean> = new Map([
	[CHECKOUT_SUBCOMMAND, is_worktree_checkout],
	[RESTORE_SUBCOMMAND, touches_worktree],
	[CLEAN_SUBCOMMAND, is_forced_clean],
	[STASH_SUBCOMMAND, is_unauthorized_stash],
])

function is_unauthorized_segment(segment: string): boolean {
	const call = git_argv.parse(segment)

	if (call === undefined) return false

	return JUDGED_SUBCOMMANDS.get(call.subcommand ?? '')?.(call.args) === true
}

function is_unauthorized_worktree_change(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_unauthorized_segment(segment))
}

// The instruction in the shape a refusal can carry: what the command touches, the authorized route,
// and — for a stash — the message form that is allowed. `pnpm josh git` and `pnpm josh stash:pop` are
// invisible to this trigger, so a run that uses them is never refused.
const WORKTREE_MUTATION_REASON =
	'⛔ unauthorized working-tree change: `git checkout -- <path>`, `git restore <path>`, a forced ' +
	'`git clean` and an unauthorized `git stash` discard work or mutate the repository-wide stash every work tree ' +
	'shares, and none is on the `.claude/settings.json` deny list (`operating-rules.md`). Do not run ' +
	'them on your own judgement. A commit goes through `pnpm josh git`; a stash pop goes through `pnpm ' +
	'josh stash:pop "<message>"`, never a positional `git stash pop` a shared stack lets another lane ' +
	'divert. A stash push is authorized only inside a documented flow and only with a findable message ' +
	'— `git stash push -u -m "<message>"` — which this row allows; a bare `git stash`, a message-less ' +
	'push, or `pop` / `apply` / `drop` is refused. A plan that restores a handed-over stash with `git ' +
	'stash apply` / `git stash pop` is read as `pnpm josh stash:pop "<message>"`: apply it that way, ' +
	'continue, and record the substitution on the Issue — Tier A, never a `needs-decision` park ' +
	'unless the plan says why the owner keeps the stash: then stop and confirm (`operating-rules.md` ' +
	'→ "no-self-staging"). **This rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'worktree-mutation',
	is_trigger: bash_triggers.on_bash_command(is_unauthorized_worktree_change),
	reason: WORKTREE_MUTATION_REASON,
	decide: (): boolean => true,
}

const worktree_guard = {
	ROW,
	WORKTREE_MUTATION_REASON,
	is_unauthorized_worktree_change,
	touches_worktree,
}

export { worktree_guard }
