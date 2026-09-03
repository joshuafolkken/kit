// Duplicate candidates for an issue nobody has filed yet.
//
// `epic:bundle` answers "does this belong with something" for an issue that already exists, from two
// strong signals: the two issues citing each other in prose, or a `blocked-by` recorded between them.
// Neither reaches a draft — it has no number, so nothing can cite it and nothing can be recorded
// against it — and the question a filing entry actually asks first is a different one: has somebody
// already filed this? (joshuafolkken/kit#1252)
//
// So this is a second signal rather than a change to that threshold. `epic:bundle` deliberately
// refuses title resemblance as grounds for *bundling*, because "related" expands without limit; the
// output here is not a bundle but a short list to read before filing, where a false positive costs
// one issue read and a false negative costs a duplicate nobody notices for days.

// Words that sit in issue titles whatever the issue is about. Left in, they lift every pair's score
// together — which does not reorder the candidates, but does drag unrelated ones over the threshold.
const STOP_WORDS: ReadonlySet<string> = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'can',
	'do',
	'for',
	'from',
	'has',
	'have',
	'in',
	'into',
	'is',
	'it',
	'its',
	'no',
	'not',
	'of',
	'on',
	'or',
	'so',
	'than',
	'that',
	'the',
	'then',
	'this',
	'to',
	'was',
	'when',
	'which',
	'with',
	'without',
])

// Everything that is not a letter or a digit separates tokens, so backticks, hyphens, colons and the
// `#` of an issue reference all fall away — `josh epic:bundle` reads as `josh`, `epic`, `bundle`.
const TOKEN_SEPARATOR = /[^a-z\d]+/u

// A single character is a fragment rather than a word: it survives as the tail of a split identifier
// far more often than it carries meaning.
const MIN_TOKEN_LENGTH = 2

// Dice: twice the shared tokens over the two sizes together.
const DICE_NUMERATOR_FACTOR = 2

// Titles are compared by which words they use, not by their spelling. Two issues about one job are
// written months apart by different sessions and share vocabulary, not word order — which is what
// rules out whole-string edit distance, and with it the maintained packages built on it.
//
// The threshold is what keeps the answer honest when there is nothing to report. It was set against
// this repository's own backlog: at 0.35 a draft's title has to share roughly a third of its
// significant words with an existing one, which admits genuine restatements and leaves pairs that
// merely share a subsystem below the line.
const SIMILARITY_THRESHOLD = 0.35

// One shared word is a coincidence — most often a subsystem name every second title carries. Two is
// the smallest number that can describe a subject rather than name a neighborhood.
const MIN_SHARED_TOKENS = 2

// The list is read by a person or an agent about to file. Past a handful it stops being read at all,
// and the ranking already puts the strongest first.
const MAX_CANDIDATES = 5

// An open issue as the duplicate search sees it. `title` is optional for the same reason it is on
// `BacklogIssue`: an issue read one at a time by reference carries none, and one with no title simply
// scores nothing rather than failing the scan.
interface ScoutIssue {
	number: number
	title?: string
	// The epic tracking it, printed beside the candidate: where similar work already lives is the
	// other half of what a filing entry is about to decide.
	epic?: number
	// An epic is a container, never a duplicate of a deliverable. Reported as one it reads as "this is
	// already filed as #<E>", and the caller is sent to run an epic that has no implementation of its
	// own. `epic_bundle.is_strong_signal` excludes them from the other half for the same reason.
	is_epic?: boolean
}

interface DuplicateCandidate {
	number: number
	title: string
	score: number
	epic?: number
}

// What the scan found: the candidates worth reading, and how many cleared the bar in total. The two
// differ once more than `MAX_CANDIDATES` match, and a caller that prints only the first number is
// reporting a truncation as a complete answer.
interface DuplicateSearch {
	candidates: Array<DuplicateCandidate>
	total: number
}

function is_significant(word: string): boolean {
	return word.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(word)
}

function tokenize(text: string): Set<string> {
	const words = text.toLowerCase().split(TOKEN_SEPARATOR)

	return new Set(words.filter((word) => is_significant(word)))
}

function shared_tokens(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	return [...left].filter((token) => right.has(token)).length
}

function dice_similarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	const total = left.size + right.size

	if (total === 0) return 0

	return (DICE_NUMERATOR_FACTOR * shared_tokens(left, right)) / total
}

// The score, or nothing when it does not clear both bars. Both are required rather than either: the
// count keeps a two-word title from scoring 1.0 on one shared word, and the ratio keeps a long title
// from qualifying on two words out of twenty.
function qualifying_score(
	query: ReadonlySet<string>,
	tokens: ReadonlySet<string>,
): number | undefined {
	if (shared_tokens(query, tokens) < MIN_SHARED_TOKENS) return undefined

	const score = dice_similarity(query, tokens)

	return score < SIMILARITY_THRESHOLD ? undefined : score
}

function to_epic_field(epic: number | undefined): { epic?: number } {
	return epic === undefined ? {} : { epic }
}

function to_candidate(
	query: ReadonlySet<string>,
	issue: ScoutIssue,
): DuplicateCandidate | undefined {
	if (issue.is_epic === true) return undefined

	const title = issue.title ?? ''
	const score = qualifying_score(query, tokenize(title))

	if (score === undefined) return undefined

	return { number: issue.number, title, score, ...to_epic_field(issue.epic) }
}

// The open issues whose titles look like this one, strongest first.
//
// Every row is scored — no prefix, no early exit. The issue this search exists to catch is the one
// another session filed minutes ago, and where that one sits in the listing is the single thing
// nobody controls (joshuafolkken/kit#1252).
function find_duplicates(title: string, issues: ReadonlyArray<ScoutIssue>): DuplicateSearch {
	const query = tokenize(title)
	const matched = issues
		.flatMap((issue) => to_candidate(query, issue) ?? [])
		.toSorted((left, right) => right.score - left.score)

	// `total` rather than the shown list's length: a caller printing only what it was handed would
	// report a truncation as a complete answer, which is the one gap in this feature that nothing else
	// reports — every other one the command has goes through `warn_about_gaps`.
	return { candidates: matched.slice(0, MAX_CANDIDATES), total: matched.length }
}

const issue_scout = {
	SIMILARITY_THRESHOLD,
	MIN_SHARED_TOKENS,
	MAX_CANDIDATES,
	tokenize,
	shared_tokens,
	dice_similarity,
	find_duplicates,
}

export type { DuplicateCandidate, DuplicateSearch, ScoutIssue }
export { issue_scout }
