import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issue_number_shape } from './issue-number-shape'

// joshuafolkken/kit#3597: one declaration of the issue-number shape, read by every command, so issue
// `0` and a leading zero are refused everywhere rather than wherever a copy happened to be strict.

const { is_issue_number, require_issue_number, ISSUE_NUMBER_PATTERN } = issue_number_shape

const SCRIPTS_ROOT = path.resolve(import.meta.dirname, '..')
const OWN_MODULE = path.join('issue', 'issue-number-shape.ts')
// A whole-token digit pattern bound to a name that says it reads an issue: the copy this module
// replaces. A count, a pid or a duration is named for what it is and is not an issue number.
const ISSUE_COPY = /^const \w*(?:ISSUE|CITE)\w* = \/\^(?:\[1-9\]\\d\*|\\d\+)\$\/u$/mu

function source_files(): Array<string> {
	return readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' }).filter(
		(file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== OWN_MODULE,
	)
}

function has_issue_copy(file: string): boolean {
	return ISSUE_COPY.test(readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8'))
}

describe('issue_number_shape', () => {
	it.each(['1', '9', '10', '3597'])('accepts %s', (value) => {
		expect(is_issue_number(value)).toBe(true)
		expect(ISSUE_NUMBER_PATTERN.test(value)).toBe(true)
	})

	it.each(['0', '00', '05', '', '-1', '1.5', '#12', '12a', ' 12', '12\n', '--evil'])(
		'refuses %j',
		(value) => {
			expect(is_issue_number(value)).toBe(false)
		},
	)

	it('throws on a value that is not an issue number, naming it', () => {
		expect(() => {
			require_issue_number('0')
		}).toThrow('Not an issue number: 0')
	})

	it('lets an issue number through', () => {
		expect(() => {
			require_issue_number('3597')
		}).not.toThrow()
	})
})

describe('the issue-number shape is declared once', () => {
	it('finds no copy of the pattern in another script', () => {
		expect(source_files().filter((file) => has_issue_copy(file))).toStrictEqual([])
	})
})
