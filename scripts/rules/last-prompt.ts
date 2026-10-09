import { json_value } from '#scripts/lib/json-value'
import { time_reported_failure } from '#scripts/time-runtime/time-reported-failure'
import { z } from 'zod'
import { filing_cap } from './filing-cap'

// The text of the person's last prompt on a transcript tail — what the stop guard's citation row
// reads to tell a `#N` the person quoted from one the run brought in itself.
//
// **A prompt is `filing_cap`'s prompt line, minus what the harness wrote there.** A skill's body is a
// `user` line with no tool result too, but it carries `isMeta`; a background task's completion notice
// and a subagent's hand-back carry an `origin` whose `kind` is not `human`. Each is the harness
// speaking, not the person — and a notice can name the very Issue the run filed — so only a line with
// no `origin` (an SDK prompt) or a `human` one is read.
//
// **A workflow invocation quotes nothing.** `fullrun #2819` names this repository's own Issue, so a
// bare `#2819` in that run's report is a citation slip like any other, and the prompt yields no text —
// a resumed lane child's prompt included, since it ends on the same invocation.

const WORKFLOW_KEYWORDS: ReadonlySet<string> = new Set([
	'kickoff',
	'fullrun',
	'halfrun',
	'prrun',
	'backlogrun',
])
const NO_PROMPT = ''
const HUMAN_ORIGIN = 'human'
// The word before the prompt's last one — where a trailing `fullrun #N` puts its keyword.
const KEYWORD_BEFORE_ARGUMENT = -2

const PROMPT_LINE_SCHEMA = z.object({
	isMeta: z.boolean().nullish(),
	origin: z.object({ kind: z.string().nullish() }).nullish(),
	message: z.object({ content: z.unknown() }),
})

type PromptLine = z.infer<typeof PROMPT_LINE_SCHEMA>

function is_person(line: PromptLine): boolean {
	if (line.isMeta === true) return false

	return line.origin === null || line.origin === undefined || line.origin.kind === HUMAN_ORIGIN
}

// The prompt line's text, or `undefined` when the harness wrote it or it does not read as one.
function person_text(line: string): string | undefined {
	const parsed = PROMPT_LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	if (!parsed.success || !is_person(parsed.data)) return undefined

	return time_reported_failure.result_text(parsed.data.message.content)
}

// A keyword opening the prompt is what a person types; a keyword before its one trailing argument is a
// lane child's resume prompt, whose preamble ends on `fullrun #N` (`lane-child-invocation.ts`).
function is_invocation(prompt: string): boolean {
	const words = prompt.trim().split(/\s+/u)

	return [words.at(0), words.at(KEYWORD_BEFORE_ARGUMENT)].some((word) =>
		WORKFLOW_KEYWORDS.has(word ?? NO_PROMPT),
	)
}

function prompt_line_text(line: string): string | undefined {
	return filing_cap.is_prompt_line(line) ? person_text(line) : undefined
}

// The last person prompt on the tail; '' when none is on it or it is an invocation.
function prompt_text(tail: string): string {
	const text = tail
		.split('\n')
		.map((line) => prompt_line_text(line))
		.findLast((one) => one !== undefined)

	return text === undefined || is_invocation(text) ? NO_PROMPT : text
}

const last_prompt = { prompt_text }

export { last_prompt }
