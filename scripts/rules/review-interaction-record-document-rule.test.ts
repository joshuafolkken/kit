import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#5595: joshuafolkken/kit#5549 moved the interaction review's findings into a slot
// the reviewer writes with `review:submit --interaction`, but `prompts/review.md` still told the
// parent to copy them by hand into `review:record --interaction`.

const REVIEW_PROMPT = 'prompts/review.md'
const SECTION_HEAD = '## Interaction review'
const NEXT_SECTION_HEAD = '## Review round cap'

function interaction_section(): string {
	const content = read_unwrapped(REVIEW_PROMPT)

	return content.slice(content.indexOf(SECTION_HEAD), content.indexOf(NEXT_SECTION_HEAD))
}

describe('prompts/review.md — the interaction review is recorded from the slot', () => {
	it('names review:record --from-slot --interaction with dispositions', () => {
		expect(interaction_section()).toContain(
			'`pnpm josh review:record --from-slot --interaction --issue <N> [<n>=<disposition> ...]`',
		)
	})

	it('no longer names the hand-copied finding form', () => {
		expect(interaction_section()).not.toContain('[<category>:<severity>:<file> ...]')
	})
})
