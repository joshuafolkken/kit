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
	is_run: true,
	is_overrun: false,
}
const ELSEWHERE: Filed = {
	reference: 'joshuafolkken/app-kit#12',
	kind: undefined,
	title: 'Fix (the) port',
	found_during: undefined,
	is_run: false,
	is_overrun: false,
}
const FROM_LANE_TEXT = '#3438[bug][run] Count the seats again (found during #3415)'

describe('run_event_filed', () => {
	it('writes the reference, the kind, the run’s mark, the title and the child that found it', () => {
		expect(run_event_filed.text_of(FROM_LANE)).toBe(FROM_LANE_TEXT)
	})

	it('reads back what it writes, with a kind or without one', () => {
		expect(run_event_filed.parse(run_event_filed.text_of(FROM_LANE))).toStrictEqual(FROM_LANE)
		expect(run_event_filed.parse(run_event_filed.text_of(ELSEWHERE))).toStrictEqual(ELSEWHERE)
	})

	// joshuafolkken/kit#3494: an event written before the kind was recorded still reads, with no kind.
	it('reads an event written before the kind as one with no kind', () => {
		expect(run_event_filed.parse('#3438 Count the seats again (found during #3415)')).toStrictEqual(
			{ ...FROM_LANE, kind: undefined, is_run: false },
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

// joshuafolkken/kit#4099: a filing outside the run carries no mark, and an event written before the
// mark reads as one filed outside.
describe('run_event_filed run mark', () => {
	it('writes no mark for a filing outside the run and reads it back as outside', () => {
		const outside = { ...FROM_LANE, is_run: false }

		expect(run_event_filed.text_of(outside)).toBe(
			'#3438[bug] Count the seats again (found during #3415)',
		)
		expect(run_event_filed.parse(run_event_filed.text_of(outside))).toStrictEqual(outside)
	})

	it('reads a title that opens with the mark on an event written before the kind as the title', () => {
		const parsed = run_event_filed.parse('#7 [run] Lap')

		expect(parsed).toStrictEqual({ ...ELSEWHERE, reference: '#7', title: '[run] Lap' })
	})
})

// joshuafolkken/kit#4880: a lane's overrun investigation marks its own filings, and an event written
// before the mark reads as the child's.
describe('run_event_filed overrun mark', () => {
	const FROM_OVERRUN: Filed = { ...FROM_LANE, is_overrun: true }

	it('writes the overrun mark after the run mark and reads it back', () => {
		expect(run_event_filed.text_of(FROM_OVERRUN)).toBe(
			'#3438[bug][run][overrun] Count the seats again (found during #3415)',
		)
		expect(run_event_filed.parse(run_event_filed.text_of(FROM_OVERRUN))).toStrictEqual(FROM_OVERRUN)
	})

	it('reads an event written before the mark as the child’s', () => {
		expect(run_event_filed.parse(FROM_LANE_TEXT)).toStrictEqual(FROM_LANE)
	})

	it('reads a title that opens with the overrun mark, written before the kind, as the title', () => {
		expect(run_event_filed.parse('#7 [overrun] Lap')?.title).toBe('[overrun] Lap')
	})
})
