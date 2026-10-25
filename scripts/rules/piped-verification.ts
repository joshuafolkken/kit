import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { shell_segments } from './shell-segments'

// The rule delivered at the call that pipes a verification command.
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
// already been rejected in writing by `tools/time/time-reported-failure.ts`: a convention is obeyed
// or it is not. `prompts/collaboration-workflow/output-bounds.md` is the single source for the rule.
//
// It lives beside the enumeration rather than inside it because `delivered-rules.ts` is the list —
// one row per rule — and a row's predicate and refusal text are that rule's own.

// The josh subcommands whose result means pass or fail — the whole reach of the rule, and no more.
// **The read-only answers are absent deliberately.** `latest:scope`, `review:level`,
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
	'check:related',
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

// **The canonical name of each check, and both spellings still match**: `pnpm josh ga | tail` masks a
// gate exactly as the long spelling does, and the alias is expanded where the command is read rather
// than by widening this set with every alias standing for one of its names. The suite names `pnpm josh ga` for that reason: an
// expansion that regressed would show up here rather than as a guard that quietly stopped firing.
function is_verification_command(segment: string): boolean {
	return shell_segments.is_josh_command(segment, VERIFICATION_COMMANDS)
}

// A pipeline reports its last command's status, so a check in any earlier segment has its verdict
// thrown away. `time_shell.discarded_commands` is what decides which segments those are — the shell
// reading is one rule kept in one place, not a second parser written here. It also decides the two
// forms this rule stands down on: a pipeline under `set -o pipefail`, which carries the check's
// status, and a command chain quoted inside a body, which is text rather than a call.
function is_masked_verification(command: string): boolean {
	return time_shell.discarded_commands(command).some((segment) => is_verification_command(segment))
}

// The masking and the ways out of it, in the shape a refusal can carry; the boundary is the topic file's. **The way
// out travels with the refusal rather than being named**, because a delivery saying only "do not pipe
// it" leaves the caller with the same long output and no sanctioned way to read it, which is what put
// the pipe there in the first place.
const PIPED_VERIFICATION_REASON =
	"⛔ piped verification: a pipeline exits with its last command's status, so `pnpm josh gate | " +
	'tail` reports success on a gate that failed. Reissue this call with no pipe (josh prints its ' +
	'verdict last), or redirect it to a file and read ranges from that file, or prefix ' +
	'`set -o pipefail`; read the verdict line, never the exit code alone ' +
	'(`prompts/collaboration-workflow/output-bounds.md`).'

// Every command position on the line: the chain cut `shell_segments` makes, each piece of a pipeline
// inside it taken on its own.
//
// **The quoted spans are blanked first, exactly as `time_shell.discarded_commands` blanks them.** A
// command chain quoted inside a body is text rather than a call, and this repository's issue bodies
// quote them constantly — without the blanking the two halves disagree, and
// `gh issue comment 1 --body "… | pnpm josh gate | …"` reads as a check whose verdict survived.
function pipelines_of(command: string): Array<Array<string>> {
	return shell_segments
		.segments_of(time_shell.unquoted(command))
		.map((segment) => segment.split('|').map((piece) => piece.trim()))
}

function command_pieces(command: string): Array<string> {
	return pipelines_of(command).flat()
}

// **The occasion this rule governs: a check whose result means pass or fail, run at all**.
// The trigger fires only on the masked spelling, so a run that never piped
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

// **The commonest masking is rewritten rather than refused**. Almost every
// refusal was a check narrowed with `| tail` or `| grep`, and the refusal cost a round trip to arrive at
// the call `set -o pipefail;` in front would have made. Prefixed, the pipeline carries the check's
// status, which is the rule's whole outcome — so the hook runs that call instead.
//
// **Only a filter that reads its input to the end qualifies.** One that exits early — `head`, or a
// `grep` stopping at its first match — closes the pipe on a check still writing, and under `pipefail` the
// check's SIGPIPE turns a passing run into exit 141; `head` also cuts the verdict line josh prints last.
// `cut`, `sort`, `uniq` and `wc` read to the end as well, and a `grep … | cut -c1-250` narrowing was the
// commonest masking still refused after #3875 (joshuafolkken/kit#3920).
//
// **Each masked check is wrapped on its own, and the rest of the line runs as typed.** Most of the
// refusals left after #3570 were a check chained beside other work — `vitest …; pnpm josh lint:related
// | tail -5; git status` — so the check's own pipeline becomes `(set -o pipefail; …)` and nothing else
// on the line is put under a `pipefail` it was not written for (joshuafolkken/kit#3875). The envelope
// carries no permission decision (`hook_decision.flow_rewrite_envelope`), so whatever else the line runs
// meets its own permission prompt exactly as the typed call would have.
//
// **The check's own pipeline is read for what the cut cannot see.** `parts_of` does not split on a lone
// `&`, so `| tail & curl …`, `| tail > ~/.zshrc` and `| tail -n $(cmd)` look like a filter after a check.
// Any `&`, redirection, backtick or `$(` there beyond the check's own `2>&1` leaves the line to the
// refusal, as does a heredoc anywhere on it, whose body lines the cut would read as commands. An
// unquoted `(` or `)` does too: the cut splits inside a group, so `(cd x && pnpm josh lint) | tail` would
// wrap the inner check and leave the group's own pipe without `pipefail`.
const PIPEFAIL_OPEN = '(set -o pipefail; '
const PIPEFAIL_CLOSE = ')'
const COMMENT_START = /(?:^|\s)#/u
const FULL_READING_FILTER = /^(?:tail|grep|cut|sort|uniq|wc)\b/u
const EARLY_EXIT_GREP =
	/^grep\b.*\s(?:-[a-zA-Z]*[lLmq]|--(?:quiet|silent|max-count|files-with(?:out)?-match))/u

const ALLOWED_OPERATORS = /2>&1|&&/gu
const SIDE_EFFECT_SYNTAX = /[&<>`]|\$\(/u
const GROUP_SYNTAX = /[()]/u

const PIPEFAIL_NOTE =
	'↻ piped verification: the josh check was piped, so its pipeline was wrapped in ' +
	"`(set -o pipefail; …)` to carry the check's status, and the rest of the line ran as typed. Read " +
	'the printed verdict, never the exit code alone — `prompts/collaboration-workflow/output-bounds.md`.'

function reads_to_the_end(piece: string): boolean {
	return FULL_READING_FILTER.test(piece) && !EARLY_EXIT_GREP.test(piece)
}

function is_filtered_check(pipeline: Array<string>): boolean {
	const [head = '', ...filters] = pipeline

	return is_verification_command(head) && filters.every((piece) => reads_to_the_end(piece))
}

function has_side_effect_syntax(command: string): boolean {
	return SIDE_EFFECT_SYNTAX.test(command.replaceAll(ALLOWED_OPERATORS, ' '))
}

// The side-effect syntax is read on the typed part, since a double-quoted `$(cmd)` still runs; the pipe
// cut and the grouping are read on the blanked one, since a quoted `|` or `(` is text.
function is_rewritable_part(raw: string, judged: string): boolean {
	const pipeline = judged.split('|').map((piece) => piece.trim())

	return !has_side_effect_syntax(raw) && !GROUP_SYNTAX.test(judged) && is_filtered_check(pipeline)
}

// Where the part's code ends: an unquoted `#` opens a comment, which would swallow the closing `)`.
function code_end(judged: string): number {
	const comment = COMMENT_START.exec(judged)

	return comment === null ? judged.length : comment.index
}

// The part with its surrounding whitespace and any trailing comment kept outside the subshell, so the
// line reads as typed.
function wrapped(raw: string, judged: string): string {
	const code = raw.slice(0, code_end(judged))
	const core = code.trim()
	const lead = code.slice(0, code.indexOf(core))

	return `${lead}${PIPEFAIL_OPEN}${core}${PIPEFAIL_CLOSE}${raw.slice(lead.length + core.length)}`
}

// One part of the line as it will run: as typed where it masks nothing, wrapped where it masks a check a
// wrapper can carry, and `undefined` where it masks one no wrapper can.
function rewritten_part(raw: string, judged: string): string | undefined {
	if (!is_masked_verification(judged)) return raw

	return is_rewritable_part(raw, judged) ? wrapped(raw, judged) : undefined
}

// The command with every masked check wrapped, judged on the quote-blanked line and cut from the typed
// one at the same offsets — a `|` inside `grep -E "a|b"` is text, and the typed line keeps its quotes.
function pipefail_command(command: string): string | undefined {
	const judged = time_shell.blanked(command)

	if (judged === undefined || !is_masked_verification(command)) return undefined

	const offset = { at: 0 }
	const parts = shell_segments.parts_of(judged).map((part) => {
		const raw = command.slice(offset.at, offset.at + part.length)

		offset.at += part.length

		return rewritten_part(raw, part)
	})

	const rewritten = parts.includes(undefined) ? undefined : parts.join('')

	// A line masked as a whole but in no part wraps nothing, so no note may claim a wrap.
	return rewritten === command ? undefined : rewritten
}

// The call's input with each masked check wrapped, or `undefined` where the call is not a rewritable
// masking.
function pipefail_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (call.name !== cost_blocks.BASH_TOOL || !json_value.is_record(call.input)) return undefined

	const command = pipefail_command(time_shell.bash_command(call.input))

	return command === undefined ? undefined : { ...call.input, command }
}

const piped_verification = {
	PIPED_VERIFICATION_REASON,
	PIPEFAIL_NOTE,
	VERIFICATION_COMMANDS,
	is_masked_verification,
	keeps_verdict_intact,
	pipefail_input,
	runs_verification,
}

export { piped_verification }
