import { describe, expect, it } from 'vitest'
import { git_epic_sections } from './git-epic-sections'

const DECISIONS_HEADING = /^#{1,6}[ \t]+Decisions\b/u
const BLANK = ''
const FENCE = '```md'
const FENCE_END = '```'
const DECISIONS = '## Decisions'
const PROGRESS = '## Progress'
const ROW = '- [ ] #1'
const ENTRY = '### one'

function range_of(lines: ReadonlyArray<string>): { start: number; end: number } | undefined {
	return git_epic_sections.find_section_range(
		git_epic_sections.to_body_lines(lines.join('\n')),
		DECISIONS_HEADING,
	)
}

describe('git_epic_sections.find_section_range', () => {
	it('runs from the line after the heading to the next heading', () => {
		const found = range_of([DECISIONS, BLANK, ENTRY, BLANK, PROGRESS, ROW])

		expect(found).toStrictEqual({ start: 1, end: 4 })
	})

	it('runs to the end of the body when nothing follows the section', () => {
		const found = range_of([PROGRESS, ROW, DECISIONS, BLANK, ENTRY])

		expect(found).toStrictEqual({ start: 3, end: 5 })
	})

	it('answers undefined when the body has no such section', () => {
		expect(range_of([PROGRESS, ROW])).toBeUndefined()
	})

	// A heading inside a fenced block is an illustration — the epic body quotes the `## Decisions`
	// template — and reading one as real would place a record inside the quote.
	it('ignores a heading inside a fenced block', () => {
		const found = range_of([FENCE, DECISIONS, FENCE_END, PROGRESS, ROW])

		expect(found).toBeUndefined()
	})

	// The same mask on the closing side: a fenced heading must not end the section either.
	it('does not end the section at a heading inside a fenced block', () => {
		const found = range_of([DECISIONS, ENTRY, FENCE, PROGRESS, FENCE_END, BLANK])

		expect(found).toStrictEqual({ start: 1, end: 6 })
	})
})

describe('git_epic_sections.is_in_range', () => {
	it('is half-open, so the first line of what follows is outside', () => {
		const range = { start: 2, end: 5 }

		expect([1, 2, 4, 5].map((index) => git_epic_sections.is_in_range(index, range))).toStrictEqual([
			false,
			true,
			true,
			false,
		])
	})
})

// The rule scopes the `Dependencies` rewrite too, which used to stop at a heading of any level. Pinned
// here as well as on the `Dependencies` side so the two consumers cannot drift apart.
describe('git_epic_sections.find_section_range — a deeper heading belongs to the section', () => {
	const DEPENDENCIES = /^#{1,6}[ \t]+Dependencies\b/u

	it('does not end a level-2 section at a level-3 heading', () => {
		const lines = ['## Dependencies', '### notes', '#1 -> #2', PROGRESS, ROW]
		const found = git_epic_sections.find_section_range(
			git_epic_sections.to_body_lines(lines.join('\n')),
			DEPENDENCIES,
		)

		expect(found).toStrictEqual({ start: 1, end: 3 })
	})
})
