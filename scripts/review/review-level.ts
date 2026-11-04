// Mechanical scope classification. Executable changes retain the default level.

type ReviewLevel = 'low' | 'medium'

const DEFAULT_LEVEL: ReviewLevel = 'medium'
const REDUCED_LEVEL: ReviewLevel = 'low'

// Inert remains separate from reduced review: round 2 uses it to identify non-executing fixes.
const INERT_PATHS: ReadonlyArray<string> = [
	'.editorconfig',
	'.gitignore',
	'CHANGELOG.md',
	'LICENSE',
]

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

function is_reduced_path(relative: string): boolean {
	return (
		is_inert(relative) ||
		relative.endsWith('.md') ||
		['docs/', 'prompts/', 'tests/'].some((prefix) => relative.startsWith(prefix)) ||
		/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relative)
	)
}

function level_for(paths: ReadonlyArray<string>): ReviewLevel {
	const changed = paths.map((path) => path.trim()).filter((path) => path !== '')

	if (changed.length === 0) return DEFAULT_LEVEL

	return changed.every((relative) => is_reduced_path(relative)) ? REDUCED_LEVEL : DEFAULT_LEVEL
}

// The paths that forced the default level, so the answer can say why rather than only what.
function deciding_paths(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((path) => path.trim()).filter((path) => path !== '' && !is_reduced_path(path))
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
