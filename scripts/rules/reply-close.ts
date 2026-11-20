import { session_language } from '#scripts/josh/session-language'
import { concise_reply } from './concise-reply'
import type { MeasuredRule } from './delivered-rules'
import { reply_prose } from './reply-prose'
import { stop_decision } from './stop-decision'

// A chat reply ends saying what comes next, or that nothing is left in the session, so a person
// closing the session need not ask: `prompts/collaboration-workflow/principles.md` → "concise-reply";
// the close lines are this file's.

// Either language's close is accepted, whatever the session language; the refusal names the session's.
const NEXT_LABEL = /^(?:次の一手|next)[*_]*\s*[:：]/iu
const NOTHING_LEFT: ReadonlyArray<string> = [
	'このセッションのやり残しはない',
	'nothing left in this session',
]
const JA_CLOSE = '`次の一手: <次にすべきこと>` か `このセッションのやり残しはない`'
const EN_CLOSE = '`Next: <what to do next>` or `Nothing left in this session`'
// A line with no letter or digit — blank, or left blank by the code, links and paths `reply_prose`
// takes out — separates paragraphs, so a close followed by bare URLs still ends the reply.
const CONTENT_PATTERN = /[\p{L}\p{N}]/u

const SECTION = 'concise-reply'
// The constant opening `rule-value.ts` credits a Stop refusal to this row by.
const REASON_OPENING = `⛔ reply close: your reply's last paragraph has no close line of \`prompts/collaboration-workflow/principles.md\` → "${SECTION}"`

function is_close(line: string): boolean {
	const bare = stop_decision.bare_line(line)
	const lower = bare.toLowerCase()

	return NEXT_LABEL.test(bare) || NOTHING_LEFT.some((close) => lower.startsWith(close))
}

function last_paragraph(message: string): ReadonlyArray<string> {
	const paragraphs: Array<Array<string>> = [[]]

	for (const line of reply_prose.prose_of(message).split('\n')) {
		if (CONTENT_PATTERN.test(line)) paragraphs.at(-1)?.push(line)
		else paragraphs.push([])
	}

	return paragraphs.findLast((paragraph) => paragraph.length > 0) ?? []
}

// `prompt` is the person's last prompt — `undefined` when it could not be read, and then nothing is
// refused. A code-block-only reply is a fixed output; a `Recommended:` line is the next step itself.
function is_open(message: string, prompt: string | undefined): boolean {
	if (prompt === undefined || stop_decision.decision_of(message) !== undefined) return false
	const paragraph = last_paragraph(message)

	return paragraph.length > 0 && paragraph.every((line) => !is_close(line))
}

function close_form(lang: string): string {
	return session_language.is_japanese(lang) ? JA_CLOSE : EN_CLOSE
}

function close_note(lang: string): string {
	return ` End its last paragraph with ${close_form(lang)}.`
}

// The instruction the over-long refusal carries too, so one rewrite fixes both; empty for a closed reply.
function note_of(message: string, prompt: string | undefined, lang: string): string {
	return is_open(message, prompt) ? close_note(lang) : ''
}

// The refusal carries the section itself, so the rewrite needs no read.
function build_reason(lang: string, root?: string): string {
	const head = `${REASON_OPENING}. Rewrite it ending with ${close_form(lang)} — do not repeat your previous reply.`
	const body = concise_reply.section_text(root)

	return body === undefined ? head : `${head}\n\n${body}`
}

function reason_of(message: string, prompt: string | undefined, lang: string): string | undefined {
	return is_open(message, prompt) ? build_reason(lang) : undefined
}

const ROW: MeasuredRule = {
	id: 'reply-close',
	reason: REASON_OPENING,
	about: {
		title: 'Reply close',
		topic: `\`principles.md\` → "${SECTION}"`,
		entry: 'pnpm josh stop:guard',
		fires:
			'a reply whose last paragraph has no `次の一手:` / `Next:` line and no `このセッションのやり残しはない` / `Nothing left in this session` line. Blocks the stop',
		quiet:
			'a reply with a `Recommended:` decision, a reply that is only a code block (a fixed output), a held stop with no decision (its own refusal asks for the close), no prompt of the person’s on the transcript tail, or an unattended session (headless, a lane child, the backlogrun parent)',
	},
}

const reply_close = { REASON_OPENING, ROW, build_reason, close_note, is_open, note_of, reason_of }

export { reply_close }
