import { cost_blocks, type ContentBlock } from './cost-blocks'
import { cost_tokens } from './cost-tokens'

// What the conversation half of the context is made of (joshuafolkken/kit#1151).
//
// `cost-report.ts` already splits billed input into the resident preamble and the history. This
// splits the history itself, into the four quantities joshuafolkken/kit#1150 measured by hand on one
// run — tool results 37.7%, Bash command bodies 30.2%, thinking 24.9%, text 4.7% — so the next run
// that needs those shares reads them from a command instead of writing the script again.
// joshuafolkken/kit#1159 is the first such consumer: it has to re-measure the command-body share
// against that 30.2% baseline.
//
// **Three things are outside this table, on purpose.** The resident preamble is `cost-resident.ts`'s
// subject; `attachment` lines, which Claude Code writes beside the message rather than inside it,
// carry no stable shape to classify; and a `UserPromptSubmit` hook's injection arrives folded into
// the user's own turn, so it is counted as text here and named separately in the resident
// breakdown, which is where its per-turn cost is the point.

const TOOL_RESULT_LABEL = 'tool_result'
const BASH_LABEL = 'Bash command bodies'
const THINKING_LABEL = 'thinking'
const TEXT_LABEL = 'text'
const OTHER_TOOL_USE_LABEL = 'tool_use inputs (excl. Bash bodies)'

interface Bucket {
	count: number
	tokens: number
}

interface Tally {
	tool_result: Bucket
	bash: Bucket
	text: Bucket
	other_tool_use: Bucket
}

const EMPTY_BUCKET: Bucket = { count: 0, tokens: 0 }
const EMPTY_TALLY: Tally = {
	tool_result: EMPTY_BUCKET,
	bash: EMPTY_BUCKET,
	text: EMPTY_BUCKET,
	other_tool_use: EMPTY_BUCKET,
}

function plus(bucket: Bucket, text: string): Bucket {
	return { count: bucket.count + 1, tokens: bucket.tokens + cost_tokens.estimate(text) }
}

// A Bash call contributes to both buckets: its command body to the row being tracked, and the rest
// of its input — the description, the timeout — to the general tool_use row. Counting the call once
// in each is what makes the two rows add up to the whole input.
function apply_tool_use(tally: Tally, block: ContentBlock): Tally {
	const other_tool_use = plus(tally.other_tool_use, block.text)

	if (block.tool_name !== cost_blocks.BASH_TOOL) return { ...tally, other_tool_use }

	return { ...tally, other_tool_use, bash: plus(tally.bash, block.command) }
}

function apply(tally: Tally, block: ContentBlock): Tally {
	if (block.type === cost_blocks.TOOL_RESULT_TYPE) {
		return { ...tally, tool_result: plus(tally.tool_result, block.text) }
	}

	if (block.type === cost_blocks.TOOL_USE_TYPE) return apply_tool_use(tally, block)
	if (block.type === cost_blocks.TEXT_TYPE) return { ...tally, text: plus(tally.text, block.text) }

	return tally
}

function tally_blocks(blocks: ReadonlyArray<ContentBlock>): Tally {
	let tally = EMPTY_TALLY

	for (const block of blocks) tally = apply(tally, block)

	return tally
}

// `is_estimated` is carried per row rather than stated once for the table, because exactly one row
// is not estimated. Thinking text is never written to the transcript, so its count comes from the
// API's own `thinking_tokens` — the only row here a reader may treat as exact.
interface CompositionRow {
	category: string
	block_count: number
	tokens: number
	is_estimated: boolean
}

interface Composition {
	rows: Array<CompositionRow>
	total_tokens: number
}

function to_row(category: string, bucket: Bucket): CompositionRow {
	return { category, block_count: bucket.count, tokens: bucket.tokens, is_estimated: true }
}

// Ordered by what the categories mean rather than by size, so two runs' tables line up row for row
// and a share can be read off without sorting first.
function to_rows(tally: Tally, thinking_tokens: number): Array<CompositionRow> {
	return [
		to_row(TOOL_RESULT_LABEL, tally.tool_result),
		to_row(BASH_LABEL, tally.bash),
		{ category: THINKING_LABEL, block_count: 0, tokens: thinking_tokens, is_estimated: false },
		to_row(TEXT_LABEL, tally.text),
		to_row(OTHER_TOOL_USE_LABEL, tally.other_tool_use),
	]
}

function build(blocks: ReadonlyArray<ContentBlock>, thinking_tokens: number): Composition {
	const rows = to_rows(tally_blocks(blocks), thinking_tokens)

	return { rows, total_tokens: rows.reduce((sum, row) => sum + row.tokens, 0) }
}

const LABEL_WIDTH = 36
const COUNT_WIDTH = 5
const TOKEN_WIDTH = 11
const SHARE_WIDTH = 6
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1

function format_row(row: CompositionRow, total: number): string {
	const count = row.block_count === 0 ? '' : String(row.block_count)
	const share =
		total === 0 ? 'n/a' : `${((row.tokens / total) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
	const note = row.is_estimated ? '' : '  (measured)'

	return `  ${row.category.padEnd(LABEL_WIDTH)}${count.padStart(COUNT_WIDTH)}  ${row.tokens.toLocaleString('en-US').padStart(TOKEN_WIDTH)}  ${share.padStart(SHARE_WIDTH)}${note}`
}

function format_composition(composition: Composition): Array<string> {
	return [
		"Context composition (blocks written to this session's transcript; estimated except thinking):",
		...composition.rows.map((row) => format_row(row, composition.total_tokens)),
		`  ${'total'.padEnd(LABEL_WIDTH)}${''.padStart(COUNT_WIDTH)}  ${composition.total_tokens.toLocaleString('en-US').padStart(TOKEN_WIDTH)}`,
	]
}

const cost_composition = {
	BASH_LABEL,
	THINKING_LABEL,
	TOOL_RESULT_LABEL,
	TEXT_LABEL,
	OTHER_TOOL_USE_LABEL,
	build,
	format_composition,
}

export type { Composition, CompositionRow }
export { cost_composition }
