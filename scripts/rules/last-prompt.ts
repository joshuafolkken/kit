import { json_value } from '#scripts/lib/json-value'
import { time_reported_failure } from '#scripts/time-runtime/time-reported-failure'
import { z } from 'zod'
import { turn_filings } from './turn-filings'

// The person's prompts on a transcript tail — what the stop guard reads to tell a question it answers
// and the pause a recorded notify belongs to.
//
// **A prompt is `turn_filings`' prompt line, minus what the harness wrote there.** A skill's body is a
// `user` line with no tool result too, but it carries `isMeta`; a background task's completion notice
// and a subagent's hand-back carry an `origin` whose `kind` is not `human`. Each is the harness
// speaking, not the person, so only a line with no `origin` (an SDK prompt) or a `human` one is read.

const NO_PROMPT = ''
const HUMAN_ORIGIN = 'human'

const PROMPT_LINE_SCHEMA = z.object({
	isMeta: z.boolean().nullish(),
	timestamp: z.string().nullish(),
	origin: z.object({ kind: z.string().nullish() }).nullish(),
	message: z.object({ content: z.unknown() }),
})

const TIMED_LINE_SCHEMA = z.object({ timestamp: z.string() })

type PromptLine = z.infer<typeof PROMPT_LINE_SCHEMA>

function is_person(line: PromptLine): boolean {
	if (line.isMeta === true) return false

	return line.origin === null || line.origin === undefined || line.origin.kind === HUMAN_ORIGIN
}

// The prompt line as the person wrote it, or `undefined` when the harness wrote it or it does not
// read as one.
function person_line(line: string): PromptLine | undefined {
	const parsed = PROMPT_LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	return parsed.success && is_person(parsed.data) ? parsed.data : undefined
}

// The prompt line's text, or `undefined` when the harness wrote it or it does not read as one.
function person_text(line: string): string | undefined {
	const person = person_line(line)
	if (person === undefined) return undefined

	return time_reported_failure.result_text(person.message.content)
}

// **The prompt that opened this turn, when a person typed it** — '' when the harness opened it (a task
// notification, a subagent's hand-back), so a question asked turns ago does not answer for a stop the
// run reached on its own since (`stop-decision.ts` → `is_question`).
function turn_prompt(tail: string): string {
	const opener = tail.split('\n').findLast((line) => turn_filings.is_prompt_line(line))
	if (opener === undefined) return NO_PROMPT

	return person_text(opener) ?? NO_PROMPT
}

// When the person last prompted on the tail, or `undefined` when no prompt of theirs is on it.
function prompt_time(tail: string): string | undefined {
	return tail
		.split('\n')
		.filter((line) => turn_filings.is_prompt_line(line))
		.map((line) => person_line(line)?.timestamp ?? undefined)
		.findLast((time) => time !== undefined)
}

// The first dated line on the tail, or `undefined` when none is.
function tail_time(tail: string): string | undefined {
	return tail
		.split('\n')
		.map((line) => TIMED_LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line)).data?.timestamp)
		.find((time) => time !== undefined)
}

// **When the current pause began, as far as the tail shows** — what a recorded notify is compared
// against. A person's prompt ends the pause it reported, so the last one opens the next; with none on
// the tail, only a send dated inside the tail is provably after every prompt, and an older send is
// announced again (joshuafolkken/kit#3961).
function pause_start(tail: string): string | undefined {
	return prompt_time(tail) ?? tail_time(tail)
}

const last_prompt = { pause_start, turn_prompt }

export { last_prompt }
