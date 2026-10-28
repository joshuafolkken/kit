// The resolution of a merge that stopped on `document-byte-budget.ts`'s ceiling rows
// (joshuafolkken/kit#4976). Two lanes that grow the same page each raise that page's ceiling and add a
// comment naming their Issue, so the later merge stops on the same row from both sides.
//
// **Only a hunk made of ceiling rows and their comments is resolved**: each side is comment lines
// followed by at most one ceiling row, both rows name the same page, and the result keeps every
// comment from both sides and the larger ceiling. A hunk holding only comments is resolved only when
// the row it annotates follows it. Any other hunk — the table's structure, another function — throws,
// so the merge stays the `conflict` it was. The merged page's size is still checked against the kept
// ceiling by `document-byte-budget.test.ts`.

const BUDGET_TABLE_PATH = 'scripts/document/document-byte-budget.ts'
const CEILING_ROW = /^\t\{ path: '(?<path>[^']+)', bytes: (?<bytes>[\d_]+) \},$/u
const COMMENT_PREFIX = '\t// '
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7}|\|{7})/mu
// A diff3 base section, dropped before the hunks are read: the resolution needs only the two sides.
const BASE_SECTION = /^\|{7} .*\n(?:.*\n)*?(?=={7}\n)/gmu
// One conflict hunk; the line after it is captured without being consumed.
const HUNK = /^<{7} .*\n(?<ours>(?:.*\n)*?)={7}\n(?<theirs>(?:.*\n)*?)>{7} .*\n(?=(?<after>.*))/gmu

interface Side {
	comments: ReadonlyArray<string>
	row: string | undefined
}

function side_of(text: string): Side {
	const lines = text.split('\n').slice(0, -1)
	const last = lines.at(-1) ?? ''
	const row = CEILING_ROW.test(last) ? last : undefined
	const comments = row === undefined ? lines : lines.slice(0, -1)

	if (comments.some((line) => !line.startsWith(COMMENT_PREFIX))) {
		throw new Error(`${BUDGET_TABLE_PATH}: a conflict outside the ceiling rows`)
	}

	return { comments, row }
}

function ceiling_of(row: string): { path: string; bytes: number } {
	const groups: Partial<Record<'path' | 'bytes', string>> = CEILING_ROW.exec(row)?.groups ?? {}

	return { path: groups.path ?? '', bytes: Number(groups.bytes?.replaceAll('_', '')) }
}

function larger_row(ours: string, theirs: string): string {
	const [mine, other] = [ceiling_of(ours), ceiling_of(theirs)]

	if (mine.path !== other.path) {
		throw new Error(
			`${BUDGET_TABLE_PATH}: rows of two pages conflict (${mine.path}, ${other.path})`,
		)
	}

	return mine.bytes >= other.bytes ? ours : theirs
}

function rows_of(ours: Side, theirs: Side, after: string): ReadonlyArray<string> {
	if (ours.row !== undefined && theirs.row !== undefined) return [larger_row(ours.row, theirs.row)]
	// Equal here only when both are undefined: a hunk of comments alone, kept only above a row.
	if (ours.row === theirs.row && CEILING_ROW.test(after)) return []

	throw new Error(`${BUDGET_TABLE_PATH}: a ceiling row changed on one side only`)
}

function merge_hunk(ours: string, theirs: string, after: string): string {
	const [mine, other] = [side_of(ours), side_of(theirs)]
	const comments = [...new Set([...mine.comments, ...other.comments])]

	return [...comments, ...rows_of(mine, other, after)].map((line) => `${line}\n`).join('')
}

// The file with every hunk resolved; throws when any hunk is not a ceiling-row conflict.
function resolve(content: string): string {
	const resolved = content
		.replaceAll(BASE_SECTION, '')
		.replaceAll(HUNK, (_hunk: string, ours: string, theirs: string, after: string) =>
			merge_hunk(ours, theirs, after),
		)

	if (resolved === content || CONFLICT_MARKER.test(resolved)) {
		throw new Error(`${BUDGET_TABLE_PATH}: a conflict left unresolved`)
	}

	return resolved
}

const main_merge_budget_conflict = { BUDGET_TABLE_PATH, resolve }

export { main_merge_budget_conflict }
