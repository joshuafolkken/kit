import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { review_attest } from './review-attest'
import { review_prompt_level } from './review-prompt-level'

// joshuafolkken/kit#5555: a reviewer prompt opens with the brief's level, so `lane:breakdown` prints it.

const make_directory = temporary_directory()
const MISSING_BRIEF = '/nonexistent/brief.md'

function brief_file(text: string): string {
	const directory = make_directory('review-prompt-level-')
	const file = path.join(directory, 'brief.md')

	writeFileSync(file, text)

	return file
}

describe('review_prompt_level.opening', () => {
	it('leads with the level on the brief first line, then the trigger', () => {
		expect(review_prompt_level.opening(brief_file('medium\n## Rubric\n'), 'initial')).toBe(
			'medium — trigger: initial — ',
		)
	})

	it('carries only the trigger for a brief not written', () => {
		expect(review_prompt_level.opening(MISSING_BRIEF, 'paired')).toBe('trigger: paired — ')
	})

	it('carries only the trigger for a brief not opening with a level', () => {
		expect(review_prompt_level.opening(brief_file('## Rubric\nmedium\n'), 'round-2')).toBe(
			'trigger: round-2 — ',
		)
	})
})

// joshuafolkken/kit#8337: the trigger a launch prompt carries reads back for `cost:audit`.
describe('review_prompt_level.trigger_of', () => {
	it.each(review_prompt_level.TRIGGERS)('reads %s back with and without a level', (trigger) => {
		const with_level = `${review_prompt_level.opening(brief_file('high\n'), trigger)}Review`
		const without_level = `${review_prompt_level.opening(MISSING_BRIEF, trigger)}Review`

		expect(review_prompt_level.trigger_of(with_level)).toBe(trigger)
		expect(review_prompt_level.trigger_of(without_level)).toBe(trigger)
		expect(review_prompt_level.level_of(with_level)).toBe('high')
		expect(review_prompt_level.level_of(without_level)).toBeUndefined()
	})

	it('reads no trigger from a prompt written before it carried one, or an unknown word', () => {
		expect(review_prompt_level.trigger_of('medium — Review this checkout')).toBeUndefined()
		expect(review_prompt_level.trigger_of('trigger: rerun — Review')).toBeUndefined()
	})
})

describe('review_prompt_level.round_one_trigger', () => {
	it('names the interaction slot interaction and the code slot initial', () => {
		expect(review_prompt_level.round_one_trigger(review_attest.REVIEW_SLOT.INTERACTION)).toBe(
			'interaction',
		)
		expect(review_prompt_level.round_one_trigger(review_attest.REVIEW_SLOT.CODE)).toBe('initial')
	})
})

// joshuafolkken/kit#8379: each retry word a launch writes is one `trigger_of` reads back.
describe('review_prompt_level.RETRY', () => {
	it('names only triggers', () => {
		expect(review_prompt_level.TRIGGERS).toStrictEqual(
			expect.arrayContaining(Object.values(review_prompt_level.RETRY)),
		)
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
