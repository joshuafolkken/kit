import { describe, expect, it } from 'vitest'
import type { ContentBlock } from './cost-blocks'
import { cost_composition, type CompositionRow } from './cost-composition'
import { cost_tokens } from './cost-tokens'

const THINKING_TOKENS = 1234
const RESULT_TEXT = 'a'.repeat(300)
const COMMAND_TEXT = 'b'.repeat(150)
const INPUT_TEXT = '{"description":"x"}'
const TEXT_BLOCK_TEXT = 'c'.repeat(60)
const CATEGORY_COUNT = 5
const TOOL_USE_CALLS = 2

function block(partial: Partial<ContentBlock>): ContentBlock {
	return { type: 'text', tool_name: '', command: '', text: '', ...partial }
}

const BLOCKS: ReadonlyArray<ContentBlock> = [
	block({ type: 'tool_result', text: RESULT_TEXT }),
	block({ type: 'tool_use', tool_name: 'Bash', command: COMMAND_TEXT, text: INPUT_TEXT }),
	block({ type: 'tool_use', tool_name: 'Read', text: INPUT_TEXT }),
	block({ type: 'text', text: TEXT_BLOCK_TEXT }),
	block({ type: 'thinking', text: '' }),
]

// Throws rather than falling back to the first row: a missing category is a defect in `build`, and
// silently reading another row's numbers would let every assertion below pass against the wrong row.
function row_named(rows: ReadonlyArray<CompositionRow>, category: string): CompositionRow {
	const row = rows.find((candidate) => candidate.category === category)

	if (row === undefined) throw new Error(`no composition row named ${category}`)

	return row
}

const COMPOSITION = cost_composition.build(BLOCKS, THINKING_TOKENS)

describe('build — the estimated categories', () => {
	const composition = COMPOSITION

	it('estimates tool results', () => {
		const row = row_named(composition.rows, cost_composition.TOOL_RESULT_LABEL)

		expect(row).toMatchObject({
			block_count: 1,
			tokens: cost_tokens.estimate(RESULT_TEXT),
			is_estimated: true,
		})
	})

	// The row joshuafolkken/kit#1159 has to re-measure. It exists because the command body is the
	// quantity joshuafolkken/kit#1150 measured at 30.2%, and folding it into the tool input would
	// make it unreadable.
	it('reports Bash command bodies on their own', () => {
		expect(row_named(composition.rows, cost_composition.BASH_LABEL)).toMatchObject({
			block_count: 1,
			tokens: cost_tokens.estimate(COMMAND_TEXT),
		})
	})

	// A Bash call is counted in both rows: its body in one, the rest of its input in the other. That
	// is what makes the two add up to the whole input rather than double-counting or losing part.
	it('counts every tool_use input, Bash included, in the general row', () => {
		expect(row_named(composition.rows, cost_composition.OTHER_TOOL_USE_LABEL)).toMatchObject({
			block_count: TOOL_USE_CALLS,
			tokens: cost_tokens.estimate(INPUT_TEXT) * TOOL_USE_CALLS,
		})
	})

	it('estimates text', () => {
		expect(row_named(composition.rows, cost_composition.TEXT_LABEL)).toMatchObject({
			block_count: 1,
			tokens: cost_tokens.estimate(TEXT_BLOCK_TEXT),
		})
	})
})

describe('build — the shape of the table', () => {
	const composition = COMPOSITION

	// The one row a reader may treat as exact: the transcript stores no thinking text, so the count
	// comes from the API rather than from this file's estimator.
	it('takes thinking from the API count and marks it measured', () => {
		expect(row_named(composition.rows, cost_composition.THINKING_LABEL)).toMatchObject({
			tokens: THINKING_TOKENS,
			is_estimated: false,
		})
	})

	it('totals every row', () => {
		expect(composition.total_tokens).toBe(
			composition.rows.reduce((sum, row) => sum + row.tokens, 0),
		)
	})

	it('keeps the row order stable so two runs line up', () => {
		expect(composition.rows.map((row) => row.category)).toStrictEqual([
			cost_composition.TOOL_RESULT_LABEL,
			cost_composition.BASH_LABEL,
			cost_composition.THINKING_LABEL,
			cost_composition.TEXT_LABEL,
			cost_composition.OTHER_TOOL_USE_LABEL,
		])
	})
})

describe('build — nothing to read', () => {
	const empty = cost_composition.build([], 0)

	it('reports zeroes rather than failing', () => {
		expect(empty.total_tokens).toBe(0)
		expect(empty.rows).toHaveLength(CATEGORY_COUNT)
	})

	// A zero denominator would print `NaN%`, which reads as a defect in the reader rather than as an
	// empty session.
	it('prints n/a instead of dividing by nothing', () => {
		expect(cost_composition.format_composition(empty).join('\n')).toContain('n/a')
	})
})

describe('format_composition — the printed table', () => {
	const lines = cost_composition.format_composition(COMPOSITION)

	it('labels the estimate in its heading', () => {
		expect(lines[0]).toContain('estimated except thinking')
	})

	it('marks the one measured row', () => {
		expect(lines.filter((line) => line.includes('(measured)'))).toHaveLength(1)
	})

	it('ends with a total', () => {
		expect(lines.at(-1)).toContain('total')
	})
})
