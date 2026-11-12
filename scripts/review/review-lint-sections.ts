import { document_section } from '#scripts/document/document-section'

// The parsing half of the review lint `review:submit --review` runs: a review's markdown split into
// its `###` sections, and a section's list items grouped with their indented continuation lines. The checks live in
// `review-lint.ts` and `review-lint-findings.ts`; nothing here judges what it reads.

interface ReviewSection {
	readonly heading: string
	readonly lines: ReadonlyArray<string>
}

const HEADING_PREFIX = '### '
// `### 1. Bug risks & logic errors` and `### Project conventions (`CLAUDE.md`)` are the rubric's own
// category headings, so the number and a trailing parenthetical are dropped before the name is read.
const NUMBER_PREFIX = /^\d+\.\s+/u
const TRAILING_NOTE = / \([^)]*\)$/u
// A list item at column 0; an indented one is a continuation of the item above it.
const TOP_LEVEL_ITEM = /^(?:[-*]|\d+\.)\s+/u
const CONTINUATION = /^\s+\S/u

function heading_name(line: string): string {
	return line
		.slice(HEADING_PREFIX.length)
		.trim()
		.replace(NUMBER_PREFIX, '')
		.replace(TRAILING_NOTE, '')
		.trim()
}

// Lines before the first heading belong to no section and are not read; a `###` line inside a code
// fence is quoted text, not a heading.
function parse_sections(review: string): ReadonlyArray<ReviewSection> {
	const lines = review.split('\n')
	const fenced = document_section.fenced_flags(lines)
	const heading_flags = lines.map(
		(line, index) => fenced[index] !== true && line.startsWith(HEADING_PREFIX),
	)
	const sections: Array<{ heading: string; lines: Array<string> }> = []

	for (const [index, line] of lines.entries()) {
		if (heading_flags[index] === true) sections.push({ heading: heading_name(line), lines: [] })
		else sections.at(-1)?.lines.push(line)
	}

	return sections
}

function has_content(section: ReviewSection): boolean {
	return section.lines.some((line) => line.trim().length > 0)
}

function body_text(section: ReviewSection): string {
	return section.lines.join('\n').trim()
}

// A line extends the block above it only when indented; any other non-blank line opens a new block —
// an item's own, or a closed one for prose, which closes the item above it and takes no continuation.
function add_line(blocks: Array<Array<string> | undefined>, line: string): void {
	if (CONTINUATION.test(line)) blocks.at(-1)?.push(line)
	else if (line.trim().length > 0) blocks.push(TOP_LEVEL_ITEM.test(line) ? [line] : undefined)
}

// Each top-level item with its indented continuation lines, joined; a sentence after a list is never
// read as part of its last item.
function item_blocks(lines: ReadonlyArray<string>): ReadonlyArray<string> {
	const blocks: Array<Array<string> | undefined> = []

	for (const line of lines) add_line(blocks, line)

	return blocks.filter((block) => block !== undefined).map((block) => block.join('\n'))
}

function item_text(block: string): string {
	return block.replace(TOP_LEVEL_ITEM, '')
}

const review_lint_sections = { parse_sections, has_content, body_text, item_blocks, item_text }

export type { ReviewSection }
export { review_lint_sections }
