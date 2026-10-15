import { describe, expect, it } from 'vitest'
import { run_board_thanks_csv } from './run-board-thanks-csv'

// joshuafolkken/kit#3809: the reviewers' roster is a spreadsheet anyone with edit access changes, so
// only a `name,url` sheet is read, a row with no name or a link that is not `https://` is dropped, and
// a name loses its control characters and is cut to a limit.

const { NAME_LIMIT, thanks_of } = run_board_thanks_csv
const ESCAPE = '\u{1B}'
// Joined at run time, so no formatter rewrites the scheme the test is about.
const INSECURE = ['http', '//example.com'].join(':')

describe('run_board_thanks_csv.thanks_of', () => {
	it('reads each name, with its link where the row has one', () => {
		const csv = 'name,url\nfish,\nKittenLab,https://x.com/KittenLab\n'

		expect(thanks_of(csv)).toStrictEqual([
			{ name: 'fish', url: undefined },
			{ name: 'KittenLab', url: 'https://x.com/KittenLab' },
		])
	})

	it('reads a quoted cell holding a comma, and a row with no url column at all', () => {
		const csv = 'name,url\r\n"Doe, Jane",https://example.com/jane\r\nsolo\r\n'

		expect(thanks_of(csv)).toStrictEqual([
			{ name: 'Doe, Jane', url: 'https://example.com/jane' },
			{ name: 'solo', url: undefined },
		])
	})

	it.each([
		['a header that is not name,url', 'person,link\nfish,\n'],
		['a header with a third column', 'name,url,note\nfish,,\n'],
		['an empty text', ''],
		['a text that is not CSV', 'name,url\n"unclosed,\n'],
	])('answers undefined for %s', (_label, csv) => {
		expect(thanks_of(csv)).toBeUndefined()
	})
})

describe('run_board_thanks_csv.thanks_of rows', () => {
	it('drops a row with no name and a row whose url is not https', () => {
		const csv = [
			'name,url',
			',https://example.com/nobody',
			'   ,',
			`plain,${INSECURE}`,
			'script,javascript:alert(1)',
			'spaced,https://example .com',
			'kept,',
		].join('\n')

		expect(thanks_of(csv)).toStrictEqual([{ name: 'kept', url: undefined }])
	})

	it('strips the control characters from a name, and drops a row whose url holds one', () => {
		const csv = `name,url\nre${ESCAPE}[31md\u{7},\nbell,https://example.com/${ESCAPE}]8;;\n`

		expect(thanks_of(csv)).toStrictEqual([{ name: 're[31md', url: undefined }])
	})

	it('cuts a long name to the limit', () => {
		const [thanker] = thanks_of(`name,url\n${'x'.repeat(NAME_LIMIT * 2)},\n`) ?? []

		expect(thanker?.name).toHaveLength(NAME_LIMIT)
		expect(thanker?.name.endsWith('…')).toBe(true)
	})
})
