// The prose of a session-facing reply — the text a person reads as sentences, with code, links and
// bare paths taken out. Two Stop rules read it: the reply's language (`reply-language.ts`) and its
// length (`concise-reply.ts`).

const CODE_PATTERNS: ReadonlyArray<RegExp> = [
	/```[\s\S]*?(?:```|$)/gu,
	/`[^`\n]*`/gu,
	/\]\([^)\s]*\)/gu,
	/https?:\/\/\S+/gu,
]
// A run of printable ASCII; one holding a slash is a bare path the reply printed outside backticks.
const ASCII_RUN_PATTERN = /[!-~]+/gu
// A table row or a list item — the structure a reply's points are carried in, not its narrative.
const STRUCTURE_LINE_PATTERN = /^\s*(?:\||[-*+] |[・•] ?|\d+\. )/u

function prose_of(message: string): string {
	let text = message

	for (const pattern of CODE_PATTERNS) text = text.replaceAll(pattern, ' ')

	return text.replaceAll(ASCII_RUN_PATTERN, (run) => (run.includes('/') ? ' ' : run))
}

// The prose outside tables and lists: what a reply narrates around its one table or list.
function narrative_of(message: string): string {
	return prose_of(message)
		.split('\n')
		.filter((line) => !STRUCTURE_LINE_PATTERN.test(line))
		.join('\n')
}

const reply_prose = { narrative_of, prose_of }

export { reply_prose }
