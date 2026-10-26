// The long-line ceiling of the command reference — one source for `command-reference.test.ts` and the
// fast `josh lint:related` path (`document-ratchet-check.ts`), so the two can never hold different
// lines. A reference entry is a short summary; the why behind it lives in the page's maintainer
// rationale file. The pages once carried 137 lines over 400 characters (joshuafolkken/kit#3868); the
// ceiling is a ratchet at the long lines left after condensing them, so lowering it is the only way
// it moves.

// The only files under `docs/` an agent is routed to read — the four command references; the rest of
// `docs/` is reference a human browses, so the byte budget (`document/document-byte-budget.ts`)
// covers these alone.
const COMMAND_REFERENCE_DOCS: ReadonlyArray<string> = [
	'docs/josh-commands.md',
	'docs/josh-commands-automation.md',
	'docs/josh-commands-run.md',
	'docs/josh-commands-backlog.md',
]
const LONG_LINE_CHARACTERS = 400
const MAX_LONG_LINES = 3

// The lines over the length limit across every page handed in — the ceiling holds the pages
// together, so one page's cut makes room in another.
function long_line_count(texts: ReadonlyArray<string>): number {
	return texts
		.flatMap((text) => text.split('\n'))
		.filter((line) => line.length > LONG_LINE_CHARACTERS).length
}

// The failure for a count over the ceiling, or undefined at or under it.
function long_line_violation(count: number): string | undefined {
	if (count <= MAX_LONG_LINES) return undefined

	return `the command reference (${COMMAND_REFERENCE_DOCS.join(', ')}) has ${count.toString()} lines over ${LONG_LINE_CHARACTERS.toString()} characters, over its ceiling of ${MAX_LONG_LINES.toString()}. Shorten the entry — the why belongs in the page's maintainer rationale file.`
}

const command_reference_line_budget = {
	COMMAND_REFERENCE_DOCS,
	long_line_count,
	long_line_violation,
	MAX_LONG_LINES,
}

export { command_reference_line_budget }
