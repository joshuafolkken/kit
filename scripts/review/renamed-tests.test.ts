import { describe, expect, it } from 'vitest'
import { renamed_tests } from './renamed-tests'

// joshuafolkken/kit#7883: a removed test whose body arrived under another title is a rename, so its
// replacement row is read from the change instead of searched for by the reviewer.

const OLD = 'board > drops'
const NEW = 'board > drops a row'
const BODY = '() => {\n\texpect(board_rows.drop(board, 1)).toStrictEqual([ROW_A, ROW_C])\n}'
const REFORMATTED = '() => { expect(board_rows.drop(board, 1)).toStrictEqual([ROW_A, ROW_C]) }'
const REWRITTEN = "() => {\n\trender(view)\n\texpect(screen.getByRole('row')).toBeVisible()\n}"

describe('renamed_tests.renamed — removed tests whose body arrived under a new title', () => {
	it('pairs a test whose title alone changed with its new title', () => {
		const before = [{ title: OLD, body: BODY }]
		const after = [{ title: NEW, body: REFORMATTED }]

		expect(renamed_tests.renamed(before, after, [OLD])).toStrictEqual([{ from: OLD, to: NEW }])
	})

	it('does not take a test whose body was rewritten for a rename', () => {
		const after = [{ title: NEW, body: REWRITTEN }]

		expect(renamed_tests.renamed([{ title: OLD, body: BODY }], after, [OLD])).toStrictEqual([])
	})

	it('does not take a test whose asserted literal changed for a rename', () => {
		const changed = BODY.replace('board, 1', 'board, 2')

		const before = [{ title: OLD, body: BODY }]

		expect(renamed_tests.renamed(before, [{ title: NEW, body: changed }], [OLD])).toStrictEqual([])
	})

	it('lets one arrived test answer for one removed test only', () => {
		const before = [
			{ title: OLD, body: BODY },
			{ title: 'board > drops twice', body: BODY },
		]
		const removed = before.map((entry) => entry.title)

		expect(renamed_tests.renamed(before, [{ title: NEW, body: BODY }], removed)).toHaveLength(1)
	})

	it('reads a title the base already held as no new name', () => {
		const before = [
			{ title: OLD, body: BODY },
			{ title: NEW, body: BODY },
		]

		expect(renamed_tests.renamed(before, [{ title: NEW, body: BODY }], [OLD])).toStrictEqual([])
	})
})

describe('renamed_tests.similarity — the share of tokens two bodies have in common', () => {
	it('is whole for the same tokens laid out differently', () => {
		expect(renamed_tests.similarity(BODY, REFORMATTED)).toBe(1)
	})

	it('is nothing for bodies with no word in them, so empty callbacks never pair', () => {
		expect(renamed_tests.similarity('() => {}', '() => {}')).toBe(0)
		expect(renamed_tests.similarity('', '')).toBe(0)
	})
})
