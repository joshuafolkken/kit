import { cost_blocks } from '#scripts/cost/cost-blocks'
import { json_value } from '#scripts/json-value'
import type { GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'
import { shell_segments } from './shell-segments'

// The trigger and the decision behind the `run-tail` row of `delivered-rules.ts`
// (joshuafolkken/kit#1510).
//
// **Two stops, one cause.** `fullrun #1501` ran 45m03s on about 17 minutes of work. Of the 25 idle
// minutes, 6m28s was a `pnpm josh git -y` issued in the **foreground** with a 900-second tool
// timeout — above the harness's 600-second cap, so the harness detached it at the cap and nothing
// read the output file afterwards — and 6m06s was bare CI: the push landed, the turn ended, and the
// merge started only when the person asked whether it was merging. Both halves handed the deciding
// of when to look back to something that was never going to decide it.
//
// **So the refusal is put in front of the foreground call, which is the last call before the seam.**
// A turn ending between the push and `pnpm josh followup` is an *absence* of a call, and no
// `PreToolUse` hook can see one; the foreground push is a call, and refusing it delivers both halves
// at the one moment they still bind. That is the same reading joshuafolkken/kit#1570 took for a wait
// timer and joshuafolkken/kit#1556 for a verification behind a pipe.
//
// **Backgrounding is what closes the seam, rather than a second rule about turns.** A command issued
// with `run_in_background` re-invokes the run when it exits, so the completion notification is what
// resumes the tail — not a person noticing the silence. joshuafolkken/kit#1333 had already
// established the same end state as a procedure, and symptom 2 is its regression; prose that had to
// be remembered was what regressed, so this time the moment is named as a call.
//
// **A call already made properly is not a trigger.** Reissued with `run_in_background`, the same
// command falls through and the run pays nothing — the shape `is_body_only_issue_read` takes for a
// read that already asked for the comments.

// **Anchored at the segment's command position, never searched anywhere in the line** — the
// correction `time-shell.ts` records for `JOSH_PATTERN`. This repository's commit messages and Issue
// comments name josh subcommands constantly, and a loose search would refuse a `git commit` whose
// message quotes the step.
//
// **What may stand in front of it is what `time-shell.ts`'s own walker skips**, so the two readers of
// one command cannot disagree: an opening subshell parenthesis, environment assignments, and the
// package-manager wrapper in either of its spellings. Left out, `JOSH_CI_TIMEOUT_SECONDS=600 pnpm
// josh git -y` and `(pnpm josh git -y)` are silently not the push step, and the run pays the tail the
// rule exists to stop. `g` is the alias `josh-command-map.ts` resolves to `git`.
const SEGMENT_PREFIX = String.raw`(?:\(\s*)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:npx\s+|pnpm\s+(?:exec\s+|run\s+)?)?`
// A closing parenthesis ends a word as a space does, so every boundary below admits it — without
// that, a subshell defeats the flag test even where it does not defeat the command test.
const WORD_END = String.raw`(?=\s|$|\))`
const PUSH_STEP_SEGMENT = new RegExp(String.raw`^${SEGMENT_PREFIX}josh\s+(?:git|g)${WORD_END}`, 'u')
// The confirmation flag, which is what makes it the run's own commit-push-PR step rather than a
// person's interactive invocation.
const CONFIRMED_FLAG = new RegExp(String.raw`(?:^|\s)(?:-y|--yes)${WORD_END}`, 'u')
// **The documented recovery path is not this step.** `pnpm josh git -y --skip-commit --skip-push`
// opens the pull request for a push that already landed (`CLAUDE.md` → Git Rules): seconds, and no
// tail to save. Refusing it would spend a delivery on a call the rule has nothing to say about.
const SKIPS_THE_PUSH = new RegExp(String.raw`(?:^|\s)--skip-push${WORD_END}`, 'u')

// How the harness names a deliberately detached call. Its presence is the whole of the exemption:
// the completion notification exists, so nothing has to remember to look.
const BACKGROUND_KEY = 'run_in_background'

// **A flag is only a flag outside the quotes**, and `josh git` takes the pull-request title as a
// positional argument — so this repository's own titles quote flag names constantly. Left in, the
// commit that shipped this very rule (`… "Exclude --skip-push from the run-tail trigger #1510"`)
// would have exempted itself from it. Quoted spans are blanked rather than removed, so two words
// either side of one cannot be joined into a third.
const QUOTED_SPAN = /"[^"]*"|'[^']*'/gu

function flags_of(segment: string): string {
	return segment.replaceAll(QUOTED_SPAN, ' ')
}

function is_push_step_segment(segment: string): boolean {
	if (!PUSH_STEP_SEGMENT.test(segment)) return false

	const flags = flags_of(segment)

	if (SKIPS_THE_PUSH.test(flags)) return false

	return CONFIRMED_FLAG.test(flags)
}

/** Whether this command runs the commit, push and pull-request step. Judged from the call alone. */
function is_push_step(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_push_step_segment(segment))
}

function is_backgrounded(input: unknown): boolean {
	if (!json_value.is_record(input)) return false

	return input[BACKGROUND_KEY] === true
}

/**
 * The occasion this rule governs: the push step, in either spelling (joshuafolkken/kit#1643).
 *
 * It is the denominator `scripts/rules/rule-value.ts` reads for this row, because the trigger below
 * fires only on the foreground spelling — a run that detached every push never trips it, so the rate
 * would otherwise be taken over runs that pushed in the foreground at least once.
 *
 * **The tool name is checked here rather than through `on_bash_command`**, because the trigger and
 * the compliance test both read a second field of the input and that helper hands over only the
 * command string. Refusing a write tool is out of the question for the reason `delivered-rules.ts`
 * gives — a denied `Edit` leaves its siblings applied and itself not.
 */
function is_push_step_call(call: GuardedCall): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return is_push_step(time_shell.bash_command(call.input))
}

/** Keeping the rule: the same push step, issued detached. */
function is_backgrounded_push_step(call: GuardedCall): boolean {
	if (!is_backgrounded(call.input)) return false

	return is_push_step_call(call)
}

/** The trigger: the push step issued in the foreground. */
function is_foreground_push_step(call: GuardedCall): boolean {
	if (is_backgrounded(call.input)) return false

	return is_push_step_call(call)
}

/**
 * Fires on every foreground push, not once per run.
 *
 * **The subject is a recurring act, which is the test `DeliveredRule.decide` states.** Once per run
 * is right for a rule a run then obeys — read the comments, count the Issues — because the refusal
 * changes what the run *knows*. A push does not work that way: a `queue` or an `epicrun` issues one
 * per child, and a round-2 fix commit issues a second inside a single `fullrun`. Refused once and
 * free afterwards, every push but the first is back to the run's own self-restraint, which is the
 * thing joshuafolkken/kit#1333 already measured failing.
 *
 * **It also removes the stand-aside this row has no use for.** `is_first_delivery` stays silent for
 * ten seconds after the batching guard stamps any refusal; the push step is never a candidate of that
 * guard, so standing aside there was pure loss — in a `fullrun` with one push, the rule would be lost
 * for the whole run with nothing recorded to say so. A row that decides for itself is asked
 * unconditionally, and this one records nothing, so `can_record` has nothing to protect.
 */
function decide(): boolean {
	return true
}

// The instruction in the shape a refusal can carry: what the call is about to cost, the reissue that
// avoids it, and the half a run forgets once the push has landed. The measurement is named because it
// is what makes the rule believable — the work was 17 minutes and the run was 45.
const RUN_TAIL_REASON =
	'⛔ run tail: this issues the commit-push-PR step in the foreground, where the harness decides ' +
	'when to stop waiting. Reissue it with `run_in_background` set. In `fullrun #1501` this call was ' +
	'given a 900-second timeout, the harness detached it at its own 600-second cap, and nothing read ' +
	'the output for a further 6m28s — 45m03s of wall clock on about 17 minutes of work ' +
	'(joshuafolkken/kit#1510). **Never give a foreground call a timeout above the harness cap**: the ' +
	'cap decides, not the number. A backgrounded call re-invokes you when it exits, so the completion ' +
	'notification is what resumes the run. **When it arrives, the turn that reads it goes straight ' +
	'through any branch-2 filing and `pnpm josh epic:bundle` to `pnpm josh followup` — the turn never ' +
	'ends at the push.** CI went green 6m06s before the merge started in that run, and it started ' +
	'only because the person asked; joshuafolkken/kit#1333 had already settled that the merge is ' +
	'issued in the turn the review closes. While the push runs, do the work that writes nothing — ' +
	'drafting the completion body to a file, deciding the branch-2 disposition. `pnpm josh followup` ' +
	'itself stays in the **foreground** — nearly every step after it reads its result. But a tail ' +
	'does follow the merge, measured at 3.0 min and 5.9% of a run (joshuafolkken/kit#1462), so ' +
	'empty it beforehand: the steps that read the merge result stay after `followup`, and the rest ' +
	'are composed in the turn that issues it, bar the one exception §2h names. The ' +
	'procedure is `.claude/skills/workflow-commands/SKILL.md` → §2h, "A command that can take minutes ' +
	'is issued in the background". **This rule fires on every foreground push, not once per run**, so ' +
	'reissuing the same call in the foreground will be refused again.'

const run_tail = {
	RUN_TAIL_REASON,
	decide,
	is_backgrounded_push_step,
	is_foreground_push_step,
	is_push_step,
	is_push_step_call,
}

export { run_tail }
