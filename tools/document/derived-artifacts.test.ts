import { document_byte_budget } from '#scripts/document/document-byte-budget'
import { describe, expect, it } from 'vitest'
import { derived_artifacts } from './derived-artifacts'

const BUDGETED_PAGE = 'docs/josh-commands.md'

function ceiling(): number {
	return document_byte_budget.recorded_bytes_for(BUDGETED_PAGE) ?? 0
}

describe('the byte report of a written page', () => {
	it('prints the bytes beside the ceiling and what is left', () => {
		const line = derived_artifacts.byte_line({ path: BUDGETED_PAGE, bytes: ceiling() - 10 })

		expect(line).toBe(
			`${BUDGETED_PAGE}: ${String(ceiling() - 10)} / ${String(ceiling())} bytes, 10 left`,
		)
	})

	it('names a page over its ceiling', () => {
		const over = { path: BUDGETED_PAGE, bytes: ceiling() + 1 }

		expect(derived_artifacts.byte_line(over)).toMatch(`over: ${BUDGETED_PAGE} is`)
		expect(derived_artifacts.is_over(over)).toBe(true)
	})

	it('says when a page has no recorded ceiling', () => {
		const unbudgeted = { path: 'docs/not-budgeted.md', bytes: 5 }

		expect(derived_artifacts.byte_line(unbudgeted)).toBe(
			'docs/not-budgeted.md: 5 bytes, no ceiling recorded',
		)
		expect(derived_artifacts.is_over(unbudgeted)).toBe(false)
	})
})
