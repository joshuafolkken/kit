// The prose density of the documents an agent or a person reads — the two totals `josh metrics`
// holds to the merge-base, so a document that grows denser fails the gate the way a grown code total
// does (`metrics-ratchet.ts`).
//
// **A long paragraph is one past `LONG_PARAGRAPH_CHARACTERS` characters.** A paragraph is a run of
// prose lines: a blank line, a heading or a table row ends one and a list item starts a new one, so a
// document wrapped at a column and one written a paragraph per line read the same. Fenced code is not
// prose and counts for neither total.
//
// **Bold is counted per section, past one.** A section may lead with one emphasized point; every bold
// span after it is counted, so adding emphasis to a section already full of it grows the total as
// surely as a first extra one does.

const NEWLINE = '\n'
const PARAGRAPH_JOINER = ' '
const LONG_PARAGRAPH_CHARACTERS = 400
const BOLD_ALLOWANCE = 1
const FENCE = /^\s*(?:```|~~~)/u
const HEADING = /^#{1,6}\s/u
const TABLE_ROW = /^\s*\|/u
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/u
const BOLD_SPAN = /\*\*[^*\n]+\*\*/gu

interface ProseTotals {
	long_paragraphs: number
	excess_bold: number
}

// Every line with fenced code blanked out, the fence lines included — a blank still ends a paragraph.
function unfenced_lines(text: string): ReadonlyArray<string> {
	let is_fenced = false

	return text.split(NEWLINE).map((line) => {
		if (FENCE.test(line)) is_fenced = !is_fenced

		return is_fenced || FENCE.test(line) ? '' : line
	})
}

function is_break(line: string): boolean {
	return line.trim().length === 0 || HEADING.test(line) || TABLE_ROW.test(line)
}

function starts_paragraph(line: string): boolean {
	return is_break(line) || LIST_ITEM.test(line)
}

function add_line(paragraphs: Array<Array<string>>, line: string): void {
	if (starts_paragraph(line)) paragraphs.push([])
	if (!is_break(line)) paragraphs.at(-1)?.push(line.trim())
}

// Each paragraph's length in characters — UTF-16 code units, one per character for the scripts these
// documents are written in.
function paragraph_lengths(lines: ReadonlyArray<string>): ReadonlyArray<number> {
	const paragraphs: Array<Array<string>> = [[]]

	for (const line of lines) add_line(paragraphs, line)

	return paragraphs.map((paragraph) => paragraph.join(PARAGRAPH_JOINER).length)
}

function bold_count(line: string): number {
	return line.match(BOLD_SPAN)?.length ?? 0
}

// The bold spans of each section — the text before the first heading is a section of its own.
function section_bold_counts(lines: ReadonlyArray<string>): ReadonlyArray<number> {
	const counts: Array<number> = [0]

	for (const line of lines) {
		if (HEADING.test(line)) counts.push(0)

		counts.push((counts.pop() ?? 0) + bold_count(line))
	}

	return counts
}

function measure(text: string): ProseTotals {
	const lines = unfenced_lines(text)
	const long = paragraph_lengths(lines).filter((length) => length > LONG_PARAGRAPH_CHARACTERS)
	const excess = section_bold_counts(lines).map((count) => Math.max(0, count - BOLD_ALLOWANCE))

	return {
		long_paragraphs: long.length,
		excess_bold: excess.reduce((sum, count) => sum + count, 0),
	}
}

function totals(texts: ReadonlyArray<string>): ProseTotals {
	const measured = texts.map((text) => measure(text))

	return {
		long_paragraphs: measured.reduce((sum, one) => sum + one.long_paragraphs, 0),
		excess_bold: measured.reduce((sum, one) => sum + one.excess_bold, 0),
	}
}

const prose_density = {
	LONG_PARAGRAPH_CHARACTERS,
	measure,
	totals,
}

export type { ProseTotals }
export { prose_density }
