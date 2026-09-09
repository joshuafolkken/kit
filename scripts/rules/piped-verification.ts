import { time_shell } from '#scripts/time/time-shell'
import { shell_segments } from './shell-segments'

// The rule delivered at the call that pipes a verification command (joshuafolkken/kit#1556).
//
// **A pipeline exits with its last command's status.** `pnpm josh gate 2>&1 | tail -40` therefore
// answers success on a gate that printed `✗ verification gate failed`, and the failure that was
// caught was caught by a child reading the output rather than by anything the shell reported. The
// defect is not in `josh gate`, which returns non-zero correctly — it is in how the call is written,
// and a call is composed fresh every turn.
//
// **Delivered rather than written down, and the count is what decided that.** A survey of every
// document, prompt and skill in this repository found exactly one piped verification example, and it
// was the repository's own explanation of this bug — so there were no examples to rewrite, and the
// pipe is invented each time rather than copied. The other candidate, a calling convention, had
// already been rejected in writing by `scripts/time/time-reported-failure.ts`: a convention is obeyed
// or it is not. `prompts/collaboration-workflow/output-bounds.md` is the single source for the rule.
//
// It lives beside the enumeration rather than inside it because `delivered-rules.ts` is the list —
// one row per rule — and a row's predicate and refusal text are that rule's own.

// The josh subcommands whose result means pass or fail — the whole reach of the rule, and no more.
// **The read-only answers are absent deliberately.** `eval:scope`, `latest:scope`, `review:level`,
// `review:brief` and `issue:state` print an answer rather than a verdict, and `git log | head` or
// `gh issue list | head` are not josh calls at all — narrowing a listing is the ordinary way to read
// one. A trigger wide enough to reach those would refuse on the commonest shape in the transcript,
// and the enumeration's own rule is that a hook firing on the wrong turn is worse than no hook.
//
// **Two more kinds are out, and for reasons rather than by omission.** `pre-commit-type-check` and
// `pre-push-unit` are run by lefthook rather than typed by anyone, so no call of theirs is ever
// composed here; and `e2e:retry-check` *reports* whether the preview server crashed rather than
// passing or failing on it, which puts it with the answers above.
//
// **`eval` is in, even though its verdict is the last line rather than the exit code.** Piping it to
// `tail -1` does keep that line — and throws away the scenario rows the same rule requires next, since
// a `blocked` verdict has to be attributed before it blocks a merge and a red scenario may predate the
// change. The Issue that filed this rule names `eval` for that reason.
const VERIFICATION_COMMANDS: ReadonlySet<string> = new Set([
	'check',
	'cspell',
	'cspell:dot',
	'eval',
	'gate',
	'lint',
	'lint:eslint',
	'lint:prettier',
	'lint:related',
	'overrides',
	'ranges',
	'test',
	'test:e2e',
	'test:related',
	'test:unit',
])

// Both spellings of each check, **derived from the alias table rather than restated beside it**: a
// second copy of the aliases stops matching the first time one is renamed, and `pnpm josh ga | tail`
// masks a gate exactly as the long spelling does. The derivation itself is `shell-segments.ts`, shared
// with the watcher `early-heartbeat.ts` names (joshuafolkken/kit#1643).
const VERIFICATION_NAMES: ReadonlySet<string> = shell_segments.josh_names(VERIFICATION_COMMANDS)

function is_verification_command(segment: string): boolean {
	return shell_segments.is_josh_command(segment, VERIFICATION_NAMES)
}

// A pipeline reports its last command's status, so a check in any earlier segment has its verdict
// thrown away. `time_shell.discarded_commands` is what decides which segments those are — the shell
// reading is one rule kept in one place, not a second parser written here. It also decides the two
// forms this rule stands down on: a pipeline under `set -o pipefail`, which carries the check's
// status, and a command chain quoted inside a body, which is text rather than a call.
function is_masked_verification(command: string): boolean {
	return time_shell.discarded_commands(command).some((segment) => is_verification_command(segment))
}

// The masking, the two ways out of it and the boundary, in the shape a refusal can carry. **The way
// out travels with the refusal rather than being named**, because a delivery saying only "do not pipe
// it" leaves the caller with the same long output and no sanctioned way to read it, which is what put
// the pipe there in the first place.
const PIPED_VERIFICATION_REASON =
	"⛔ piped verification: a pipeline exits with its last command's status, so `pnpm josh gate | " +
	'tail` reports success on a gate that failed, and the verdict is discarded before anything reads ' +
	'it. Run the check without the pipe — josh prints its verdict line last, so the harness output cap ' +
	'keeps it even when the middle is elided. Where the output genuinely has to be narrowed, redirect ' +
	'it to a file and read ranges from that file, or prefix `set -o pipefail` so the pipeline carries ' +
	"the check's status. Read the printed verdict either way, never the exit code alone. Read-only " +
	'listings are untouched — this fires only on a command whose result means pass or fail. The rule ' +
	'is in `prompts/collaboration-workflow/output-bounds.md`. Reissue this call with no pipe — it ' +
	'fires once per run and cannot repeat on the call in hand.'

// Every command position on the line: the chain cut `shell_segments` makes, each piece of a pipeline
// inside it taken on its own.
//
// **The quoted spans are blanked first, exactly as `time_shell.discarded_commands` blanks them.** A
// command chain quoted inside a body is text rather than a call, and this repository's issue bodies
// quote them constantly — without the blanking the two halves disagree, and
// `gh issue comment 1 --body "… | pnpm josh gate | …"` reads as a check whose verdict survived.
function command_pieces(command: string): Array<string> {
	return shell_segments
		.segments_of(time_shell.unquoted(command))
		.flatMap((segment) => segment.split('|'))
		.map((piece) => piece.trim())
}

// **The occasion this rule governs: a check whose result means pass or fail, run at all**
// (joshuafolkken/kit#1643). The trigger fires only on the masked spelling, so a run that never piped
// one would drop out of the reading entirely and the rate would be taken over runs that masked at
// least once.
function runs_verification(command: string): boolean {
	return command_pieces(command).some((piece) => is_verification_command(piece))
}

// **Keeping the rule is running that check with its verdict intact** — no pipe, the last position in
// one, or `set -o pipefail` in front. Judged over the whole command, so a line that masks one check
// while running another unmasked is not credited for the half it got right.
function keeps_verdict_intact(command: string): boolean {
	return runs_verification(command) && !is_masked_verification(command)
}

const piped_verification = {
	PIPED_VERIFICATION_REASON,
	VERIFICATION_COMMANDS,
	is_masked_verification,
	keeps_verdict_intact,
	runs_verification,
}

export { piped_verification }
