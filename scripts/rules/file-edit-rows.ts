import { file_body } from './file-body'
import { file_rewrite } from './file-rewrite'
import { sed_in_place } from './sed-in-place'

// The rows that enforce `prompts/collaboration-workflow/file-edits.md`, gathered so
// `delivered-rules.ts` places them in two entries. The shell rows — a file body carried inline, and a
// `sed -i` its countable conditions do not clear — claim disjoint commands; the `Write` row sits apart
// because its place in the order is set by the edit-tool rows it overlaps.
const SHELL_ROWS = [file_body.ROW, sed_in_place.ROW] as const

const file_edit_rows = {
	FILE_BODY_REASON: file_body.FILE_BODY_REASON,
	REWRITE_ROW: file_rewrite.ROW,
	SHELL_ROWS,
}

export { file_edit_rows }
