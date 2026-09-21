import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `josh-git-bare` row of `delivered-rules.ts`
// (joshuafolkken/kit#2297): a `pnpm josh git` issued without `-y` / `--yes`.
//
// **A bare `pnpm josh git` cannot succeed from an agent, and it wastes the time it takes to fail.** The
// command prompts to confirm the staging, and with no TTY the prompt falls to its cancel branch —
// `Checking unstaged files... Found` → `Operation cancelled.` — so the run throws the time away and then
// reissues with `-y` (about 31 seconds in one measured lane). The confirmation flag is what makes it the
// run's own unattended commit-push-PR step rather than a person's interactive invocation.
//
// **It is not `run-tail`.** That row governs a `pnpm josh git -y` push already carrying the flag, issued
// in the *foreground* rather than backgrounded; this one governs a push that carries *no* flag at all.
// The two triggers are disjoint by the flag — `run-tail` requires it, this refuses its absence — so no
// two rows claim one command, which `delivered-rules-bash.test.ts` pins.
//
// **The stop is one shell call, so the rule is delivered rather than resident**
// (`prompts/collaboration-workflow/rule-delivery.md`). It fires on every occurrence: a bare invocation
// wastes the same time every time it is issued, so refused-once-and-free-after would put the next one
// back on the run's self-restraint — the disposition `git-force.ts` takes for the same reason.

// The `josh git` subcommand, in canonical form. `shell_segments.is_josh_command` canonicalizes an alias
// (`g`) before the match, so `pnpm josh g` arrives as `git`.
const GIT_COMMAND: ReadonlySet<string> = new Set(['git'])

// The confirmation flags that make the invocation unattended. Either spelling is enough; the recovery
// form `pnpm josh git -y --skip-commit --skip-push` carries `-y` and so is not bare.
const CONFIRM_FLAGS: ReadonlySet<string> = new Set(['-y', '--yes'])

function has_confirm_flag(args: ReadonlyArray<string>): boolean {
	return args.some((argument) => CONFIRM_FLAGS.has(argument))
}

// A segment that invokes `pnpm josh git` with no confirmation flag. The command test comes first, so the
// argument read runs only on a `josh git` segment. Segment-wise and alias-expanded for the reason every
// command predicate in this directory is: one shell line carries several commands, and a name quoted
// inside a body is not the command being invoked.
function is_bare_segment(segment: string): boolean {
	if (!shell_segments.is_josh_command(segment, GIT_COMMAND)) return false

	return !has_confirm_flag(time_shell.josh_arguments(segment))
}

function is_bare_josh_git(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_bare_segment(segment))
}

// The instruction in the shape a refusal can carry: what the bare call does, why it fails, and the one
// form that works. Apostrophes are avoided so the single-quoted literal needs no escaping, as the
// sibling reasons do.
const JOSH_GIT_BARE_REASON =
	'⛔ bare `pnpm josh git`: this prompts to confirm the staging, and with no TTY the prompt falls to ' +
	'its cancel branch — `Checking unstaged files... Found` then `Operation cancelled.` — so the call ' +
	'throws away the time it takes to fail (about 31 seconds in one measured lane) and you reissue it ' +
	'with `-y` anyway (joshuafolkken/kit#2297). Run it unattended from the start: ' +
	'`pnpm josh git -y "<title> #<N>"`. The recovery form that opens the PR for a push that already ' +
	'landed is `pnpm josh git -y --skip-commit --skip-push`. This rule fires on every occurrence, not ' +
	'once per run.'

// The row itself, so `delivered-rules.ts` spreads one entry. `is_trigger` reads the input through
// `on_bash_command` — the `Bash` tool-name gate every command row shares — and `decide` returns true so
// it refuses every occurrence. It declares no `keeps`: the corrected call is `pnpm josh git -y`, which is
// `run-tail`'s push step and scored there, so this row is reported unmeasured rather than double-counting
// it (`git-force.ts`).
const ROW = {
	id: 'josh-git-bare',
	is_trigger: bash_triggers.on_bash_command(is_bare_josh_git),
	reason: JOSH_GIT_BARE_REASON,
	decide: (): boolean => true,
}

const josh_git_bare = {
	JOSH_GIT_BARE_REASON,
	ROW,
	is_bare_josh_git,
}

export { josh_git_bare }
