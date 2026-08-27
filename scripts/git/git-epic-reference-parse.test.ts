import { describe, expect, it } from 'vitest'
import { parse_external_reference } from './git-epic-parse'

// joshuafolkken/kit#985: the same shorthand the task-list rows carry, read from a command argument.
// One definition for both, so a form the task list accepts cannot be refused where a person types
// it.
const REPO = 'joshuafolkken/kit'
const ISSUE_NUMBER = 909
const REFERENCE = `${REPO}#${String(ISSUE_NUMBER)}`

describe('parse_external_reference', () => {
	it('reads owner, repository and number', () => {
		expect(parse_external_reference(REFERENCE)).toStrictEqual({
			repo: REPO,
			number: ISSUE_NUMBER,
		})
	})

	it('ignores surrounding whitespace', () => {
		expect(parse_external_reference(`  ${REFERENCE} `)?.number).toBe(ISSUE_NUMBER)
	})

	it.each([
		['909'],
		['#909'],
		[REPO],
		[`${REPO}#`],
		[`${REPO}#0`],
		['owner/repo#12x'],
		[`prefix ${REFERENCE}`],
		[`${REFERENCE} suffix`],
		[`https://github.com/${REPO}/issues/${String(ISSUE_NUMBER)}`],
	])('answers nothing for %j', (text) => {
		expect(parse_external_reference(text)).toBeUndefined()
	})
})
