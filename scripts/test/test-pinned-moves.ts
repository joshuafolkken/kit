import type { Hunk } from './test-pinned-logic'

// Restore both ends of moved code without reverting unrelated changes between them (#5459).
function is_deletion(hunk: Hunk): boolean {
	return hunk.new_count === 0 && hunk.old_lines.length > 0
}

function moves_between(deletion: Hunk, insertion: Hunk): boolean {
	if (deletion.file !== insertion.file || !is_deletion(deletion)) return false

	return (
		insertion.old_lines.length === 0 &&
		JSON.stringify(deletion.old_lines) === JSON.stringify(insertion.new_lines)
	)
}

function is_move(first: Hunk, second: Hunk): boolean {
	return moves_between(first, second) || moves_between(second, first)
}

function take_pair(hunk: Hunk, remaining: Array<Hunk>): Hunk {
	const index = remaining.findIndex((candidate) => is_move(hunk, candidate))
	if (index === -1) return hunk
	const partner = remaining.splice(index, 1).at(0)

	return partner === undefined ? hunk : { ...hunk, parts: [hunk, partner] }
}

function group(hunks: ReadonlyArray<Hunk>): Array<Hunk> {
	const result: Array<Hunk> = []
	const remaining = [...hunks]

	while (remaining.length > 0) {
		const hunk = remaining.shift()
		if (hunk !== undefined) result.push(take_pair(hunk, remaining))
	}

	return result
}

const test_pinned_moves = { group }

export { test_pinned_moves }
