// What a held stop is waiting on, read from records rather than guessed from prose
// (joshuafolkken/kit#3961): the decision lines the reply states, and whether the person's own prompt
// this turn was a question.
//
// **The recommended choice is the reply's, never a fixed placeholder.** A `confirmation` reaches a
// person away from the session, and "read the reply" tells them nothing about what they are asked to
// decide. The reply names it on a line of its own — `Recommended: <choice>`, with an optional
// `Alternative: <choice>` — the same two fields `josh notify` takes, so the hook copies them rather
// than inferring them.
//
// **A turn the person opened with a question is answered in the session they are at.** Its stop is
// the answer, not a pause, so a Telegram saying "confirmation required" only buries the ones that are.

interface StopDecision {
	recommended: string
	alternative: string | undefined
}

// A label may close its emphasis before or after the colon: `**Recommended:**`, `**Recommended**:`.
const RECOMMENDED_LABEL = /^recommended[*_]*:/iu
const ALTERNATIVE_LABEL = /^alternative[*_]*:/iu
// The list bullet and the Markdown emphasis a decision line may be written with. Emphasis is
// stripped only at the edges of the label and the choice: an underscore inside a choice belongs to
// a `snake_case` name the person is asked to approve.
const LEADING_EMPHASIS = /^[*_]+/u
const TRAILING_EMPHASIS = /(?<![*_])[*_]+$/u
const BULLET = /^[-*]\s+/u

// A prompt that ends asking: a question mark, or a Japanese sentence-final question particle, before
// any trailing full stop or space.
const QUESTION_ENDING = /(?:[?？]|か|かな|かね)[\s。.]*$/u

function unwrapped(text: string): string {
	return text.trim().replace(LEADING_EMPHASIS, '').replace(TRAILING_EMPHASIS, '').trim()
}

function bare_line(line: string): string {
	return unwrapped(line.trim().replace(BULLET, ''))
}

// The choice on the reply's first line labelled `label`, or `undefined` when none carries one.
function choice_of(message: string, label: RegExp): string | undefined {
	const line = message
		.split('\n')
		.map((one) => bare_line(one))
		.find((one) => label.test(one))
	const choice = line === undefined ? undefined : unwrapped(line.replace(label, ''))

	return choice === '' ? undefined : choice
}

// The decision the reply asks for, or `undefined` when it names no recommended choice.
function decision_of(message: string): StopDecision | undefined {
	const recommended = choice_of(message, RECOMMENDED_LABEL)
	if (recommended === undefined) return undefined

	return { recommended, alternative: choice_of(message, ALTERNATIVE_LABEL) }
}

function is_question(prompt: string): boolean {
	return QUESTION_ENDING.test(prompt.trim())
}

// **A held stop with no decision line is sent back once rather than announced.** Either it waits on a
// person and has to say on what, or it waits on nobody and the notify would be the noise this rule
// exists to end; only the run can tell which, so the reason hands it both answers.
const DECISION_REASON =
	'⛔ stop decision: this working tree is held by your run and your reply names no decision. If the ' +
	'run waits on a person, end the reply with a `Recommended: <choice>` line and, where there is ' +
	'one, an `Alternative: <choice>` line — the hook sends the `confirmation` Telegram from them. If ' +
	'it waits on nobody, continue the run, or say in one line that nothing is awaited. Do not repeat ' +
	'your previous reply.'

const stop_decision = { DECISION_REASON, decision_of, is_question }

export type { StopDecision }
export { stop_decision }
