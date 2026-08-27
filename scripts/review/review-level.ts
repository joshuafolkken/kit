// Which `/code-review` level a change is reviewed at, decided from the changed paths alone
// (joshuafolkken/kit#966).
//
// **The decision takes no judgement.** "This one is small" is a judgement made under cost pressure,
// and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped —
// the same reason the cross-package interrupt removed its own "does this block?" evaluation. So the
// input is the list of changed paths and nothing else.

type ReviewLevel = 'low' | 'medium'

const DEFAULT_LEVEL: ReviewLevel = 'medium'
const REDUCED_LEVEL: ReviewLevel = 'low'

// Paths that neither execute, nor instruct, nor ship. A defect in one of these cannot change what
// any program does, cannot change what an agent does, and cannot reach a consumer — the three ways
// a defect in this repository escapes. Everything else, including every markdown file not named
// here, is reviewed at the default level.
//
// **Being distributed is disqualifying on its own**, which is why `.vscode/**`, `.gitattributes`
// and `.prettierignore` are *not* here despite looking inert: `package.json`'s `files` ships all
// three, and `josh init` / `josh sync` write them into every consumer project. Keeping them out is
// the same criterion that keeps documentation out, applied consistently.
//
// **Documentation is deliberately absent from this list**, which is the opposite of what the
// "Non-runtime updates" testing exception does with it, and the difference is not an oversight.
// That exception is about whether an automated test could have caught the defect; this is about
// whether a human reading the diff is the only thing that can. Measured on this epic:
// joshuafolkken/kit#963 and #965 were both documentation-only by that classification, and a
// `medium` review found ten real defects in each — dangling pointers into sections that had been
// removed, and citations naming the wrong file, in artifacts distributed to every consumer. No test
// covered them, because prose is what they were.
const INERT_PATHS: ReadonlyArray<string> = [
	'.editorconfig',
	'.gitignore',
	'CHANGELOG.md',
	'LICENSE',
]

// No directory is inert today. The constant stays because the check reads it, and because the next
// candidate will arrive as a directory — but an empty list is the honest answer right now.
const INERT_PREFIXES: ReadonlyArray<string> = []
const INERT_SUFFIXES: ReadonlyArray<string> = ['.code-workspace']

function is_inert(path: string): boolean {
	const normalized = path.trim()

	return (
		INERT_PATHS.includes(normalized) ||
		INERT_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
		INERT_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
	)
}

// The reduced level applies only when **every** changed path is inert. One executable or
// instruction file in the diff and the whole change is reviewed at the default level: a review
// reads the change, not a subset of it, so a per-file level would mean reviewing part of a diff.
//
// An empty diff also takes the default. There is nothing to review, so the level does not matter —
// and answering `low` to "no files changed" would let a caller that failed to read the diff receive
// a reduced level as though it had.
function level_for(paths: ReadonlyArray<string>): ReviewLevel {
	const changed = paths.map((path) => path.trim()).filter((path) => path !== '')

	if (changed.length === 0) return DEFAULT_LEVEL

	return changed.every((path) => is_inert(path)) ? REDUCED_LEVEL : DEFAULT_LEVEL
}

// The paths that forced the default level, so the answer can say why rather than only what.
function deciding_paths(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((path) => path.trim()).filter((path) => path !== '' && !is_inert(path))
}

const review_level = {
	DEFAULT_LEVEL,
	REDUCED_LEVEL,
	INERT_PATHS,
	INERT_PREFIXES,
	INERT_SUFFIXES,
	is_inert,
	level_for,
	deciding_paths,
}

export type { ReviewLevel }
export { review_level }
