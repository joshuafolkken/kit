import { tally } from './tally'
import type { TestEntry } from './test-titles'

// **A removed test whose body arrived under another title was renamed** (joshuafolkken/kit#7883): its
// replacement is that title, read from the change rather than searched for by the reviewer. Bodies are
// compared by the tokens they share (the Dice coefficient), so reformatting still matches while a
// rewritten body, or one with a changed string or number literal, does not. Each arrived test answers for one removed test only, the
// closest one first.

const SAME_BODY_SHARE = 0.8
const BOTH_SIDES = 2
const TOKEN_PATTERN = /\w+|[^\s\w]/gu
const WORD_PATTERN = /\w/u
const LITERAL_PATTERN = /'[^']*'|"[^"]*"|`[^`]*`|\b\d+\b/gu

interface Rename {
	from: string
	to: string
}

interface Scored {
	entry: TestEntry
	share: number
}

function tokens(body: string): ReadonlyArray<string> {
	return body.match(TOKEN_PATTERN) ?? []
}

function literals(body: string): string {
	return (body.match(LITERAL_PATTERN) ?? [])
		.toSorted((left, right) => left.localeCompare(right))
		.join('\n')
}

// A body with no word in it — an empty callback, or none — has nothing to compare, so it never matches;
// nor does one whose string or number literals differ, since a changed argument is a changed test.
function similarity(left: string, right: string): number {
	if (!WORD_PATTERN.test(left) || !WORD_PATTERN.test(right) || literals(left) !== literals(right)) {
		return 0
	}

	const left_tokens = tokens(left)
	const right_tokens = tokens(right)
	const total = left_tokens.length + right_tokens.length
	const held = tally.of(left_tokens)
	const shared = right_tokens.filter((token) => tally.take(held, token)).length

	return (BOTH_SIDES * shared) / total
}

function closest(gone: TestEntry, open: ReadonlyArray<TestEntry>): TestEntry | undefined {
	const scored: ReadonlyArray<Scored> = open.map((entry) => ({
		entry,
		share: similarity(gone.body, entry.body),
	}))
	const close = scored.filter((candidate) => candidate.share >= SAME_BODY_SHARE)

	return close.toSorted((left, right) => right.share - left.share)[0]?.entry
}

function claim(open: Array<TestEntry>, gone: TestEntry): ReadonlyArray<Rename> {
	const match = closest(gone, open)

	if (match === undefined) return []
	open.splice(open.indexOf(match), 1)

	return [{ from: gone.title, to: match.title }]
}

// `removed` are the titles `removed_tests.removed` listed; only an arrived title the base lacked can
// be a new name.
function renamed(
	before: ReadonlyArray<TestEntry>,
	after: ReadonlyArray<TestEntry>,
	removed: ReadonlyArray<string>,
): ReadonlyArray<Rename> {
	const base = new Map(before.map((entry) => [entry.title, entry]))
	const open = after.filter((entry) => !base.has(entry.title))
	const gone = removed.flatMap((title) => base.get(title) ?? [])

	return gone.flatMap((entry) => claim(open, entry))
}

const renamed_tests = { renamed, similarity }

export type { Rename }
export { renamed_tests }
