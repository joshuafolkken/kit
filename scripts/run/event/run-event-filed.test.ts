import { BREAKING_CHANGE_LABEL, BUG_LABEL, ENHANCEMENT_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_event_filed, type Filed } from './run-event-filed'

// joshuafolkken/kit#3430: `issue:file` writes the filed event and `run:board` reads it back through one
// format, so a filing written is a filing read.

const FROM_LANE: Filed = {
	reference: '#3438',
	kind: 'bug',
	title: 'Count the seats again',
	found_during: '3415',
}
const ELSEWHERE: Filed = {
	reference: 'joshuafolkken/app-kit#12',
	kind: undefined,
	title: 'Fix (the) port',
	found_during: undefined,
}

describe('run_event_filed', () => {
	it('writes the reference, the kind, the title and the child that found it', () => {
		expect(run_event_filed.text_of(FROM_LANE)).toBe(
			'#3438[bug] Count the seats again (found during #3415)',
		)
	})

	it('reads back what it writes, with a kind or without one', () => {
		expect(run_event_filed.parse(run_event_filed.text_of(FROM_LANE))).toStrictEqual(FROM_LANE)
		expect(run_event_filed.parse(run_event_filed.text_of(ELSEWHERE))).toStrictEqual(ELSEWHERE)
	})

	// joshuafolkken/kit#3494: an event written before the kind was recorded still reads, with no kind.
	it('reads an event written before the kind as one with no kind', () => {
		expect(run_event_filed.parse('#3438 Count the seats again (found during #3415)')).toStrictEqual(
			{ ...FROM_LANE, kind: undefined },
		)
	})

	it('reads a title that opens with a bracket that is not a kind as the title', () => {
		expect(run_event_filed.parse('#7 [wip] Draft')?.title).toBe('[wip] Draft')
	})

	it('takes the kind from the labels, a breaking change over the others', () => {
		const kinds = [BUG_LABEL, BREAKING_CHANGE_LABEL, ENHANCEMENT_LABEL]

		expect(run_event_filed.kind_of(kinds)).toBe(BREAKING_CHANGE_LABEL)
		expect(run_event_filed.kind_of(['auto-ok', ENHANCEMENT_LABEL, BUG_LABEL])).toBe(BUG_LABEL)
		expect(run_event_filed.kind_of([ENHANCEMENT_LABEL])).toBe(ENHANCEMENT_LABEL)
		expect(run_event_filed.kind_of(['documentation'])).toBeUndefined()
	})

	it('takes the kind from a label in any casing, as GitHub matches it', () => {
		expect(run_event_filed.kind_of(['Bug'])).toBe(BUG_LABEL)
	})

	it('reads a text with no reference as nothing', () => {
		expect(run_event_filed.parse('filed something')).toBeUndefined()
	})
})

// A title may itself open with what reads as a kind; the slot written against the reference keeps it
// the title's (joshuafolkken/kit#3494).
describe('run_event_filed with a title that opens with a kind', () => {
	const UNCLASSIFIED: Filed = { ...ELSEWHERE, reference: '#7', title: '[bug] Port collides' }

	it('reads it back as the title when the filing has no kind', () => {
		expect(run_event_filed.text_of(UNCLASSIFIED)).toBe('#7[] [bug] Port collides')
		expect(run_event_filed.parse(run_event_filed.text_of(UNCLASSIFIED))).toStrictEqual(UNCLASSIFIED)
	})

	it('reads it as the title on an event written before the kind', () => {
		expect(run_event_filed.parse(`#7 ${UNCLASSIFIED.title}`)).toStrictEqual(UNCLASSIFIED)
	})
})
