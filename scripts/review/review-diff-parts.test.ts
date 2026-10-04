import { describe, expect, it } from 'vitest'
import { review_diff_parts } from './review-diff-parts'

// joshuafolkken/kit#2963: the reviewer printed the rubric and the whole diff through Bash, past
// `BASH_MAX_OUTPUT_LENGTH`, and re-read each truncated result. These pin the two halves of the fix:
// every part fits under the cap, and the parts of a path are exactly its diff — nothing narrowed.

const CAP = 200
const RELATIVE = 'scripts/review/example.ts'
const LINE_COUNT = 40
const LONG_LINE_LENGTH = 1000
const DIFF = Array.from(
	{ length: LINE_COUNT },
	(_, index) => `+line ${String(index)} of the diff\n`,
)
	.join('')
	.concat('x'.repeat(LONG_LINE_LENGTH), '\n', '-tail\n')

function rejoined(parts: ReadonlyArray<string>): string {
	return parts.map((part) => review_diff_parts.body_of(part)).join('')
}

describe('review_diff_parts.part_texts — every read fits under the cap', () => {
	it('cuts a diff larger than the cap into several parts, each within it', () => {
		const parts = review_diff_parts.part_texts(RELATIVE, DIFF, CAP)

		expect(parts.length).toBeGreaterThan(1)

		for (const part of parts) expect(part.length).toBeLessThanOrEqual(CAP)
	})

	it('keeps a diff under the cap as one part', () => {
		expect(review_diff_parts.part_texts(RELATIVE, '+one\n', CAP)).toHaveLength(1)
	})

	it('names the path and the part count in every header', () => {
		const parts = review_diff_parts.part_texts(RELATIVE, DIFF, CAP)

		expect(parts.at(-1)).toContain(
			`${RELATIVE} — part ${String(parts.length)} of ${String(parts.length)}`,
		)
	})
})

describe('review_diff_parts — the parts are the whole diff', () => {
	it('concatenates back to exactly the diff it was cut from', () => {
		expect(rejoined(review_diff_parts.part_texts(RELATIVE, DIFF, CAP))).toBe(DIFF)
	})

	it('ends a part on a line boundary where the line fits', () => {
		const [first] = review_diff_parts.split_text(DIFF, CAP)

		expect(first?.endsWith('\n')).toBe(true)
	})
})

describe('review_diff_parts.reading_block — what the reviewer is told', () => {
	const second_part = '/parts/000-a-2.diff'
	const block = review_diff_parts.reading_block(
		{ [RELATIVE]: ['/parts/000-a-1.diff', second_part] },
		CAP,
	)

	it('lists every part file under its path', () => {
		expect(block).toContain(RELATIVE)
		expect(block).toContain(second_part)
	})

	it('names the Read tool and the cap, and forbids printing through Bash', () => {
		expect(block).toContain('Read tool')
		expect(block).toContain(String(CAP))
		expect(block).toContain('`cat`')
	})
})
