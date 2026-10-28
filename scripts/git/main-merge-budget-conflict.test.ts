import { describe, expect, it } from 'vitest'
import { main_merge_budget_conflict } from './main-merge-budget-conflict'

// joshuafolkken/kit#4976: a merge that stopped on `document-byte-budget.ts` keeps both sides' comments
// and the larger ceiling when every hunk is a ceiling row, and refuses any other hunk.

const OURS_MARKER = '<<<<<<< HEAD'
const BASE_MARKER = '||||||| merged common ancestors'
const SEPARATOR = '======='
const THEIRS_MARKER = '>>>>>>> main'
const BEFORE = "\t{ path: 'docs/josh-commands-automation.md', bytes: 45_056 },"
const AFTER = "\t{ path: 'docs/josh-commands.md', bytes: 57_344 },"
const OURS_COMMENT = '\t// `josh effect:audit` (joshuafolkken/kit#4958) crossed the 57344 block.'
const THEIRS_COMMENT =
	"\t// `issue:priority`'s usage section (joshuafolkken/kit#4960) crossed the 57344 block."
const BASE_ROW = "\t{ path: 'docs/josh-commands-backlog.md', bytes: 57_344 },"
const ROW_61440 = "\t{ path: 'docs/josh-commands-backlog.md', bytes: 61_440 },"
const ROW_65536 = "\t{ path: 'docs/josh-commands-backlog.md', bytes: 65_536 },"

function file_of(lines: ReadonlyArray<string>): string {
	return lines.map((line) => `${line}\n`).join('')
}

function conflicted(
	ours: ReadonlyArray<string>,
	theirs: ReadonlyArray<string>,
	after: string = AFTER,
): string {
	return file_of([BEFORE, OURS_MARKER, ...ours, SEPARATOR, ...theirs, THEIRS_MARKER, after])
}

describe('resolving a ceiling-row conflict', () => {
	it('keeps both comments and the shared ceiling of the joshuafolkken/kit#4958 / #4960 conflict', () => {
		const content = conflicted([OURS_COMMENT, ROW_61440], [THEIRS_COMMENT, ROW_61440])

		expect(main_merge_budget_conflict.resolve(content)).toBe(
			file_of([BEFORE, OURS_COMMENT, THEIRS_COMMENT, ROW_61440, AFTER]),
		)
	})

	it.each([
		['ours', [OURS_COMMENT, ROW_65536], [THEIRS_COMMENT, ROW_61440]],
		['theirs', [OURS_COMMENT, ROW_61440], [THEIRS_COMMENT, ROW_65536]],
	])('takes the larger ceiling when it is %s', (_label, ours, theirs) => {
		expect(main_merge_budget_conflict.resolve(conflicted(ours, theirs))).toBe(
			file_of([BEFORE, OURS_COMMENT, THEIRS_COMMENT, ROW_65536, AFTER]),
		)
	})

	it('keeps both comments of a hunk git trimmed down to the comments above the row', () => {
		const content = conflicted([OURS_COMMENT], [THEIRS_COMMENT], ROW_61440)

		expect(main_merge_budget_conflict.resolve(content)).toBe(
			file_of([BEFORE, OURS_COMMENT, THEIRS_COMMENT, ROW_61440]),
		)
	})
})

describe('resolving a diff3 conflict', () => {
	it('drops the base section', () => {
		const content = file_of([
			OURS_MARKER,
			OURS_COMMENT,
			ROW_61440,
			BASE_MARKER,
			BASE_ROW,
			SEPARATOR,
			THEIRS_COMMENT,
			ROW_61440,
			THEIRS_MARKER,
		])

		expect(main_merge_budget_conflict.resolve(content)).toBe(
			file_of([OURS_COMMENT, THEIRS_COMMENT, ROW_61440]),
		)
	})
})

describe('refusing a conflict outside the ceiling rows', () => {
	it.each([
		['a structural line', ['const BLOCK_BYTES = 4096'], ['const BLOCK_BYTES = 8192']],
		['rows of two pages', [ROW_61440], [AFTER]],
		['a row on one side only', [OURS_COMMENT, ROW_61440], [THEIRS_COMMENT]],
		['an empty side', [ROW_61440], []],
	])('throws on %s', (_label, ours, theirs) => {
		expect(() => main_merge_budget_conflict.resolve(conflicted(ours, theirs))).toThrow()
	})

	it('throws on comments alone that annotate no row', () => {
		const content = conflicted([OURS_COMMENT], [THEIRS_COMMENT], 'interface DocumentBudget {')

		expect(() => main_merge_budget_conflict.resolve(content)).toThrow()
	})

	it('throws on a file with no conflict hunk', () => {
		expect(() => main_merge_budget_conflict.resolve(file_of([BEFORE, AFTER]))).toThrow()
	})
})
