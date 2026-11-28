import { agent_headless } from '#scripts/agent/agent-headless'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { HookContext } from '#scripts/hooks/hook-context'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_headless } from '#scripts/run/run-headless'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_reported_failure } from '#scripts/time-runtime/time-reported-failure'
import { z } from 'zod'
import { bash_triggers } from './bash-triggers'
import { codex_prompt } from './codex-prompt'
import { issue_citation } from './issue-citation'
import { last_prompt } from './last-prompt'
import { shell_segments } from './shell-segments'

// The `unasked-filing` row of `delivered-rules.ts` (joshuafolkken/kit#7293). An interactive session
// files only on the person's instruction; an unattended run files without asking
// (`observation-filing.md`). The rule lived in a document read only once an observation turned up, so a
// consultation session that found a defect ran `issue:file` unasked — so the filing itself is refused
// when no prompt of the person's asks for it.
//
// **Unattended is read from the launch, never from the prompt.** Every session kit starts carries
// `JOSH_AGENT_HEADLESS`; the headless `backlogrun` parent and its started children carry their own marks;
// a person's own session driving a `backlogrun` owns the live carry record. None of them is gated.
//
// **The instruction is the person's last prompt**, not the prompt that opened this turn: a subagent's
// hand-back or a task notice opens a turn the person asked for earlier (`last_prompt.person_prompt`).

const FILING_WORDS: ReadonlyArray<RegExp> = [
	/起票/u,
	/issue\s*[に化]/iu,
	/\bfile (?:an? |the |this |these )?(?:issues?|it|them)\b/iu,
	// A typed command whose procedure files: a split, a prerequisite, an upstream interrupt, a `new` form.
	/^\/?(?:kickoff|fullrun|halfrun|prrun|backlogrun)\b/iu,
]

// A phrase that declines filing ("fix it without filing") is removed before FILING_WORDS is read,
// so a positive instruction beside it still counts ("don't file A, file an issue for B").
const NO_FILING_PHRASES: ReadonlyArray<RegExp> = [
	/起票(?:は)?(?:せず|しないで|なしで|なしに)/gu,
	/issue\s*に(?:せず|しないで)/giu,
	/\bwithout filing\b/giu,
	/\b(?:don['’]t|do not) file\b/giu,
]

// No-filing work defers tests and the gate to the finish; these words ask for them now
// (`principles.md` → "consult-vs-execute").
const TESTS_NOW: ReadonlyArray<RegExp> = [
	/テスト\s*[とも・、]\s*(?:gate|ゲート)\s*も/iu,
	/\btests and (?:the )?gate (?:too|now|as well)\b/iu,
]
// A clause that names them only to put them off or decline them.
const DEFERRAL =
	/ない|不要|後回し|後で|せず|なし|\b(?:don['’]t|do not|never|skip|without|later)\b/iu
const CLAUSE_END = /[。．.!?！？\n]/u

// A short yes to the model's own proposal is the confirmation the refusal asks for.
const AFFIRMATIVE = /^(?:はい|うん|お願い|どうぞ|進めて|yes|ok|okay|sure|please do|go ahead)/iu
const SHORT_REPLY = 40
// The reply must ask to file, not merely mention an issue ("No issues found; shall I commit?").
const PROPOSALS: ReadonlyArray<RegExp> = [
	/起票(?:しますか|しましょうか|してよい|して良い|してもよい)/u,
	/issue\s*に(?:しますか|しましょうか)/iu,
	/\b(?:shall|should) I file\b/iu,
	/\bfile (?:an? |this as an? |it as an? )?issues?\?/iu,
]

const ASSISTANT_LINE_SCHEMA = z.object({
	type: z.literal('assistant'),
	message: z.object({ content: z.unknown() }),
})

// `--check` validates and `--publish` finishes Issues already filed — neither creates one.
const NO_CREATE_FLAG = /\s--(?:check|publish)\b/u
// A quoted argument (a title) never carries the flag, whatever it spells.
const QUOTED = /"[^"]*"|'[^']*'/gu

const UNASKED_FILING_REASON =
	'⛔ unasked filing: this interactive session files an Issue only on the person’s explicit ' +
	'instruction (「起票」, “file an issue”, or a command whose procedure files, such as `kickoff new`). ' +
	'Propose it in the reply; once confirmed, hand it to ' +
	'`pnpm josh run:handoff kickoff new --brief-file <path>`, `<path>` from `run:handoff brief-path`. ' +
	'It fires on every occurrence ' +
	'(`.claude/skills/workflow-commands/observation-filing.md`).'

// The person's own words — quotes, code spans and fenced blocks removed.
function own_words(prompt: string): string {
	return issue_citation
		.prose_lines(prompt)
		.join('\n')
		.replaceAll(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/gu, '')
		.replaceAll(/「[^「」\n]*」|『[^『』\n]*』|"[^"\n]*"|'[^'\n]*'/gu, '')
		.trim()
}

function without_no_filing(text: string): string {
	let rest = text
	for (const pattern of NO_FILING_PHRASES) rest = rest.replaceAll(pattern, ' ')

	return rest.trim()
}

// The person's own words decline filing — the reading a no-filing run takes its instruction from.
function is_no_filing(prompt: string): boolean {
	const words = own_words(prompt)

	return without_no_filing(words) !== words
}

// A no-filing phrase declines the filing, not the tests, so its negation is no deferral.
function is_tests_now_clause(clause: string): boolean {
	const is_asked_now = TESTS_NOW.some((pattern) => pattern.test(clause))

	return is_asked_now && !DEFERRAL.test(without_no_filing(clause))
}

// The person's own words ask for the tests and the gate now — the one reading that lifts a no-filing
// run's deferral. Read per clause, so a refusal elsewhere in the prompt does not cancel the request.
function is_tests_now(prompt: string): boolean {
	return own_words(prompt)
		.split(CLAUSE_END)
		.some((clause) => is_tests_now_clause(clause))
}

function is_instructed(prompt: string): boolean {
	const rest = without_no_filing(own_words(prompt))

	return FILING_WORDS.some((pattern) => pattern.test(rest))
}

function reply_text(line: string): string {
	const parsed = ASSISTANT_LINE_SCHEMA.safeParse(
		json_value.parse_or_undefined(codex_prompt.normalize(line)),
	)

	return parsed.success ? time_reported_failure.result_text(parsed.data.message.content) : ''
}

// A prompt line the person wrote — not a skill body or a hand-back the harness wrote on a prompt line.
function is_person_line(line: string): boolean {
	return last_prompt.person_prompt(line) !== undefined
}

// The model's last words before the person's last prompt — where the proposal a yes confirms sits.
function reply_before_prompt(tail: string): string {
	const lines = tail.split('\n')
	const prompt_at = lines.findLastIndex((line) => is_person_line(line))
	const replies = lines.slice(0, Math.max(prompt_at, 0)).map((line) => reply_text(line))

	return replies.findLast((text) => text !== '') ?? ''
}

function is_confirmed(prompt: string, tail: string): boolean {
	const trimmed = prompt.trim()
	if (trimmed.length > SHORT_REPLY || !AFFIRMATIVE.test(trimmed)) return false
	const reply = reply_before_prompt(tail)

	return PROPOSALS.some((pattern) => pattern.test(reply))
}

// The person's last prompt asks for filing, or says yes to a proposed Issue — the stand-down that lets
// an instructed filing through. A prompt a large read pushed off the tail is read further back
// (`last_prompt.prompt_reach`).
function is_asked(tail: string, _call: GuardedCall, run: GuardRun): boolean {
	const text = last_prompt.prompt_reach(tail, run.transcript)
	const prompt = last_prompt.person_prompt(text) ?? ''

	return is_instructed(prompt) || is_confirmed(prompt, text)
}

function is_run_parent(context: HookContext): boolean {
	const repository = git_common_directory.repository(context.cwd)
	if (repository === undefined) return false
	const read = run_carry.read_carry(run_carry.carry_path(repository))

	return run_headless.driven_here(read, context.ancestry) !== undefined
}

function is_unattended(context: HookContext): boolean {
	const { env } = context
	if (agent_headless.is_headless(env) || run_headless.is_headless(env)) return true

	return lane_child_marker.marked_issue(env) !== undefined || is_run_parent(context)
}

function is_writing_segment(segment: string): boolean {
	if (!bash_triggers.is_issue_filing_segment(segment)) return false

	return !NO_CREATE_FLAG.test(segment.replaceAll(QUOTED, ''))
}

// `--check` and `--publish` create nothing, so only a filing that writes is gated — read per segment,
// so a checked or publishing call chained before a real filing does not let the real one through.
function is_writing_filing(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_writing_segment(segment))
}

// The command is read first, so a call that files nothing never reads the carry record.
function is_unasked_filing(call: GuardedCall, context: HookContext): boolean {
	if (!bash_triggers.on_bash_command(is_writing_filing)(call)) return false

	return !is_unattended(context)
}

// `decide` returns true so it refuses every occurrence; an instructed prompt stands it down first.
const ROW = {
	id: 'unasked-filing',
	is_trigger: is_unasked_filing,
	reason: UNASKED_FILING_REASON,
	already_satisfied: is_asked,
	decide: (): boolean => true,
	about: {
		title: 'Unasked filing',
		topic: '`.claude/skills/workflow-commands/observation-filing.md`',
		fires:
			'an interactive session’s `pnpm josh issue:file` when the person’s last prompt asks for no filing; it hands over propose-then-file. Every occurrence',
		quiet:
			'an unattended run (a kit-launched or headless session, a lane child, the `backlogrun` parent), `--check`, `--publish`, or a prompt that asks for filing',
	},
}

const unasked_filing = {
	ROW,
	is_unasked_filing,
	is_no_filing,
	is_tests_now,
	is_instructed,
	own_words,
}

export { unasked_filing }
