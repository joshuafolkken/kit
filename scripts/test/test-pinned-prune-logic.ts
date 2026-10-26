import { test_pinned_cache_logic, type GreenHunk } from './test-pinned-cache-logic'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'

// What lets a `red` verdict outlive the removal of an unpinned line (joshuafolkken/kit#5004). Removing
// the line a `green` probe named changes the code change and the failed test's import closure both, yet
// that line could be reverted with every test green, so the other hunks' `red` verdicts still hold.
//
// **The cache records each `green` hunk and `pruned`: the code change with exactly those hunks
// reverted.** A
// later run reverts each of its own hunks that is only what is left of a recorded one — the same base
// lines, its lines a subsequence of that one's — and a `pruned` that reads the same means the code
// change since differs only by lines removed from `green` hunks. Any other edit reads differently. A
// hunk that lost lines has a key of its own, so it is probed afresh. A matching hunk is not tied to its
// recorded position, so a `green` line moved elsewhere in its file reads as one removed — a stretch the
// diff's line numbers cannot settle, since every edit above a hunk shifts them.

// The code change a `pruned` digest is read off: the base commit, each changed non-test path and its
// content digest.
interface CodeChange {
	commit: string
	code: ReadonlyArray<string>
	digests: ReadonlyMap<string, string>
}

// A stub probe on an added file puts back a body it wrote, not the base's lines, so it records nothing.
function is_line_hunk(hunk: Hunk): boolean {
	return hunk.function_name === undefined
}

// The line hunks whose verdict is `green` — the ones the cache records, and the only ones its `pruned`
// reverts: a hunk that only resembles one stays, so removing it later reads as an edit.
function greens_reached(
	hunks: ReadonlyArray<Hunk>,
	verdicts: ReadonlyArray<string | undefined>,
): Array<Hunk> {
	return hunks.filter((hunk, index) => verdicts[index] === 'green' && is_line_hunk(hunk))
}

function record_of(hunk: Hunk): GreenHunk {
	return { file: hunk.file, old_lines: hunk.old_lines, new_lines: hunk.new_lines ?? [] }
}

// Every line of `part` sits in `whole`, in the same order.
function is_subsequence(part: ReadonlyArray<string>, whole: ReadonlyArray<string>): boolean {
	const remaining = [...whole]

	return part.every((line) => remaining.splice(0, remaining.indexOf(line) + 1).at(-1) === line)
}

function is_same_lines(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

// `hunk` is `green` with none of its lines added or changed, only some — or none — removed.
function is_remnant(hunk: Hunk, green: GreenHunk): boolean {
	if (!is_line_hunk(hunk) || hunk.file !== green.file) return false

	return (
		is_same_lines(hunk.old_lines, green.old_lines) &&
		is_subsequence(hunk.new_lines ?? [], green.new_lines)
	)
}

// `content` with each of `hunks` reverted, the lowest last so a revert moves none still to come.
function reverted(content: string, hunks: ReadonlyArray<Hunk>): string {
	const order = hunks.toSorted((left, right) => right.new_start - left.new_start)
	let text = content

	for (const hunk of order) {
		text = test_pinned_logic.revert(text, hunk)
	}

	return text
}

// The hunks a later run reverts: each one that is only what is left of a recorded `green` hunk.
function remnants_of(hunks: ReadonlyArray<Hunk>, greens: ReadonlyArray<GreenHunk>): Array<Hunk> {
	return hunks.filter((hunk) => greens.some((green) => is_remnant(hunk, green)))
}

// The digest of each `green` hunk's file now, with `reverts` reverted; a file the work tree no longer
// holds has none.
function pruned_digests(
	contents: ReadonlyMap<string, string>,
	reverts: ReadonlyArray<Hunk>,
	greens: ReadonlyArray<GreenHunk>,
): Map<string, string> {
	const files = [...new Set(greens.map((green) => green.file))]
	const pairs = files.flatMap((file) => {
		const content = contents.get(file)
		if (content === undefined) return []
		const own = reverts.filter((hunk) => hunk.file === file)

		return [[file, test_pinned_cache_logic.digest_of(reverted(content, own))] as const]
	})

	return new Map(pairs)
}

// The code change with `reverts` reverted. Each `green` file is listed whether or not it still differs
// from the base, so one a removal put back reads the same as one a revert did.
function pruned_of(
	code: CodeChange,
	contents: ReadonlyMap<string, string>,
	reverts: ReadonlyArray<Hunk>,
	greens: ReadonlyArray<GreenHunk>,
): string {
	const pruned = pruned_digests(contents, reverts, greens)
	const digests = new Map([...code.digests, ...pruned])
	const paths = [...new Set([...code.code, ...pruned.keys()])]

	return test_pinned_cache_logic.change_of(code.commit, paths, digests)
}

const test_pinned_prune_logic = { greens_reached, record_of, is_remnant, remnants_of, pruned_of }

export type { CodeChange }
export { test_pinned_prune_logic }
