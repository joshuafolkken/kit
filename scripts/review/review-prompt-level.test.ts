import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { review_prompt_level } from './review-prompt-level'

// joshuafolkken/kit#5555: a reviewer prompt opens with the brief's level, so `lane:breakdown` prints it.

function brief_file(text: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'review-prompt-level-'))
	const file = path.join(directory, 'brief.md')

	writeFileSync(file, text)

	return file
}

describe('review_prompt_level.opening', () => {
	it('leads with the level on the brief first line', () => {
		expect(review_prompt_level.opening(brief_file('medium\n## Rubric\n'))).toBe('medium — ')
	})

	it('is empty for a brief not written', () => {
		expect(review_prompt_level.opening('/nonexistent/brief.md')).toBe('')
	})

	it('is empty for a brief not opening with a level', () => {
		expect(review_prompt_level.opening(brief_file('## Rubric\nmedium\n'))).toBe('')
	})
})

describe('review_prompt_level.level_of', () => {
	it('reads a bare level line and a prompt lead alike', () => {
		expect(review_prompt_level.level_of('low')).toBe('low')
		expect(review_prompt_level.level_of('xhigh — Review this checkout')).toBe('xhigh')
	})

	it('reads no level from a line that only starts with a level word', () => {
		expect(review_prompt_level.level_of('lowest effort')).toBeUndefined()
		expect(review_prompt_level.level_of('Review at medium')).toBeUndefined()
	})
})
