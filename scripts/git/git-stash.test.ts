import { describe, expect, it } from 'vitest'
import { git_stash } from './git-stash'

const NUL = '\u{0}'
const MESSAGE = 'backlogrun: parked #2028'
const TOP_SUBJECT = 'On main: run:hold reclaimed before #2024'
const PARKED_SUBJECT = `On main: ${MESSAGE}`
const PARKED = { selector: 'stash@{1}', subject: PARKED_SUBJECT }
const TOP = { selector: 'stash@{0}', subject: TOP_SUBJECT }

function line(selector: string, subject: string): string {
	return `${selector}${NUL}${subject}`
}

describe('git_stash.parse_entries', () => {
	it('returns an empty list for empty output', () => {
		expect(git_stash.parse_entries('')).toEqual([])
	})

	it('splits the selector from a subject carrying spaces and colons', () => {
		const raw = [line(TOP.selector, TOP_SUBJECT), line(PARKED.selector, PARKED_SUBJECT)].join('\n')

		expect(git_stash.parse_entries(raw)).toEqual([TOP, PARKED])
	})
})

describe('git_stash.matches', () => {
	it('matches a message carried after the "On <branch>: " prefix', () => {
		expect(git_stash.matches(PARKED_SUBJECT, MESSAGE)).toBe(true)
	})

	it('matches a bare subject equal to the message', () => {
		expect(git_stash.matches(MESSAGE, MESSAGE)).toBe(true)
	})

	it('does not match a longer issue number sharing the prefix', () => {
		expect(git_stash.matches('On main: parked #200', 'parked #20')).toBe(false)
	})
})

describe('git_stash.select', () => {
	it('selects the matching entry even when another stash is on top', () => {
		expect(git_stash.select([TOP, PARKED], MESSAGE)).toEqual({
			kind: 'match',
			selector: PARKED.selector,
		})
	})

	it('reports none when no entry matches', () => {
		expect(git_stash.select([TOP], MESSAGE)).toEqual({ kind: 'none' })
	})

	it('reports ambiguous when more than one entry matches', () => {
		const duplicate = { selector: 'stash@{2}', subject: MESSAGE }

		expect(git_stash.select([PARKED, duplicate], MESSAGE)).toEqual({
			kind: 'ambiguous',
			selectors: [PARKED.selector, duplicate.selector],
		})
	})
})
