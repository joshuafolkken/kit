import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { document_section } from '#scripts/document/document-section'
import { find_package_directory } from '#scripts/josh/package-directory'
import type { MeasuredRule } from './delivered-rules'
import { reply_prose } from './reply-prose'
import { stop_decision } from './stop-decision'

// A chat reply leads with its conclusion and keeps its narrative short: the procedure is
// `prompts/collaboration-workflow/principles.md` → "concise-reply"; the limit is this file's.

// Letters and digits of narrative — prose outside code, tables and lists. Counted, not characters, so
// markdown markers and punctuation weigh nothing in any language.
const PROSE_LIMIT = 400
// A person who asked for the detail is answered with it.
const EXEMPT_WORDS: ReadonlyArray<string> = ['詳しく', '具体的に', '詳細']
const COUNTED_PATTERN = /[\p{L}\p{N}]/gu

const PRINCIPLES_FILE = 'prompts/collaboration-workflow/principles.md'
const SECTION = 'concise-reply'
const PACKAGE_DIRECTORY = find_package_directory(path.dirname(fileURLToPath(import.meta.url)))

// The constant opening `rule-value.ts` credits a Stop refusal to this row by.
const REASON_OPENING = `⛔ concise reply: your reply's prose outside code, tables and lists is over the limit of \`${PRINCIPLES_FILE}\` → "${SECTION}"`

const KEEP_DECISION = ' Keep its `Recommended:` / `Alternative:` lines as they are.'

function prose_length(message: string): number {
	return reply_prose.narrative_of(message).match(COUNTED_PATTERN)?.length ?? 0
}

function is_exempt(prompt: string): boolean {
	return EXEMPT_WORDS.some((word) => prompt.includes(word))
}

// `prompt` is the person's last prompt — `undefined` when it could not be read, and then whether they
// asked for the detail is unknown, so nothing is refused.
function is_over(message: string, prompt: string | undefined): boolean {
	if (prompt === undefined || is_exempt(prompt)) return false

	return prose_length(message) > PROSE_LIMIT
}

function section_text(root: string): string | undefined {
	const markdown = document_section.read_optional(path.join(root, PRINCIPLES_FILE))

	return markdown === undefined ? undefined : document_section.section(markdown, SECTION)?.text
}

// A held run's notify reads the decision off the rewrite, which the loop-breaker lets stop unchecked.
function decision_note(message: string): string {
	return stop_decision.decision_of(message) === undefined ? '' : KEEP_DECISION
}

// The refusal carries the section itself, so the rewrite needs no read.
function build_reason(message: string, root: string = PACKAGE_DIRECTORY): string {
	const head =
		`${REASON_OPENING} (${String(prose_length(message))} of ${String(PROSE_LIMIT)}). Rewrite it ` +
		`shorter as that section says — do not repeat your previous reply.${decision_note(message)}`
	const body = section_text(root)

	return body === undefined ? head : `${head}\n\n${body}`
}

const ROW: MeasuredRule = {
	id: SECTION,
	reason: REASON_OPENING,
	about: {
		title: 'Concise reply',
		topic: `\`principles.md\` → "${SECTION}"`,
		entry: 'pnpm josh stop:guard',
		fires: `a reply whose narrative outside code, tables and lists is over ${String(PROSE_LIMIT)} letters. Blocks the stop`,
		quiet:
			'a reply under the limit, a prompt asking for the detail (`詳しく` / `具体的に` / `詳細`), a fixed output in a code block, no prompt of the person’s on the transcript tail, or a headless session',
	},
}

const concise_reply = {
	EXEMPT_WORDS,
	PROSE_LIMIT,
	REASON_OPENING,
	ROW,
	build_reason,
	is_over,
	prose_length,
}

export { concise_reply }
