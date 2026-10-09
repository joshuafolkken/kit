import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'
import { worktree_guard } from './worktree-guard'

// The trigger and the delivered text behind the `index-mutation` row of `delivered-rules.ts`.
// `CLAUDE.md` → Git Rules forbids staging or otherwise mutating the git index
// on the run's own judgement, and `.claude/settings.json` backs it with `Bash(git add*)` /
// `Bash(git commit*)` and their siblings — but those are prefix globs, so `git -C . commit`,
// `git -c k=v commit` and `env git commit` all pass them. Reading the argv through `git-argv.ts`, the
// cut `git-force.ts` already uses, is what makes the judgement independent of the spelling.
//
// **The scope is accident prevention, not a sandbox.** Under `bypassPermissions` with `Bash(*)` a run
// that means to get round the guard can always do so through `python -c` or a script; the decision
// recorded on the Issue is to stop the variant spellings a run types by accident. The authorized
// commit flow is `pnpm josh git -y`, which spawns git in a child process this hook never sees.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does: overwriting the user's
// staged snapshot is destructive each time it is issued.

// The subcommands that write the index outright. `stage` is `add`'s synonym; `rm` and `mv` stage the
// removal or rename they make.
const INDEX_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'add',
	'commit',
	'mv',
	'reset',
	'rm',
	'stage',
])
const RESTORE_SUBCOMMAND = 'restore'

// A `git restore` that touches only the index (`--staged` / `-S` without `--worktree` / `-W`). One that
// touches the working tree is the `worktree-mutation` row's, so the two rows never claim one command.
function is_index_restore(args: ReadonlyArray<string>): boolean {
	return !worktree_guard.touches_worktree(args)
}

function is_index_segment(segment: string): boolean {
	const call = git_argv.parse(segment)

	if (call === undefined) return false
	if (INDEX_SUBCOMMANDS.has(call.subcommand ?? '')) return true

	return call.subcommand === RESTORE_SUBCOMMAND && is_index_restore(call.args)
}

function is_index_mutation(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_index_segment(segment))
}

const INDEX_MUTATION_REASON =
	'⛔ git index mutation: `git add` / `stage` / `commit` / `reset` / `rm` / `mv` and `git restore ' +
	"--staged` overwrite the user's staged snapshot, which `CLAUDE.md` → Git Rules forbids on your own " +
	'judgement (`prompts/collaboration-workflow/operating-rules.md` → "no-self-staging"). The ' +
	'`.claude/settings.json` deny list matches prefix globs, so it misses `git -C . commit`, `git -c ' +
	'k=v commit` and `env git commit`; this row reads the argv instead, so the spelling does not matter. ' +
	'A commit goes through `pnpm josh git -y`; any other staging needs explicit current-turn user ' +
	'instruction, run by the user in their own terminal. **This rule fires on every occurrence, not once ' +
	'per run.**'

const ROW = {
	id: 'index-mutation',
	is_trigger: bash_triggers.on_bash_command(is_index_mutation),
	reason: INDEX_MUTATION_REASON,
	decide: (): boolean => true,
}

const index_guard = { INDEX_MUTATION_REASON, ROW, is_index_mutation }

export { index_guard }
