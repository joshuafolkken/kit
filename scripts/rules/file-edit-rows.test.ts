import { describe, expect, it } from 'vitest'
import { file_body } from './file-body'
import { file_edit_rows } from './file-edit-rows'

// joshuafolkken/kit#5284: the rows that enforce `file-edits.md`, grouped for `delivered-rules.ts`.

describe('file_edit_rows', () => {
	it('groups the shell rows in order', () => {
		expect(file_edit_rows.SHELL_ROWS.map((row) => row.id)).toStrictEqual([
			'file-body',
			'sed-in-place',
		])
	})

	it('keeps the Write row apart', () => {
		expect(file_edit_rows.REWRITE_ROW.id).toBe('file-rewrite')
	})

	it('passes the file-body reason through', () => {
		expect(file_edit_rows.FILE_BODY_REASON).toBe(file_body.FILE_BODY_REASON)
	})
})
