// Mechanical scope and size classification; an unknown executable size keeps the default.
import { path_decision } from '#scripts/josh/path-decision'

type ReviewLevel = 'low' | 'medium'

const DEFAULT_LEVEL: ReviewLevel = 'medium'
const REDUCED_LEVEL: ReviewLevel = 'low'
const TINY_CHANGE_LINES = 20

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

function is_tiny(changed_lines: number | undefined): boolean {
	return changed_lines !== undefined && changed_lines >= 0 && changed_lines <= TINY_CHANGE_LINES
}

function level_for(paths: ReadonlyArray<string>, changed_lines?: number): ReviewLevel {
	const changed = paths.map((path) => path.trim()).filter((path) => path !== '')

	if (changed.length === 0) return DEFAULT_LEVEL

	if (changed.every((relative) => is_reduced_path(relative))) return REDUCED_LEVEL

	return is_tiny(changed_lines) ? REDUCED_LEVEL : DEFAULT_LEVEL
}

// The paths that forced the default level, so the answer can say why rather than only what.
function deciding_paths(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((path) => path.trim()).filter((path) => path !== '' && !is_reduced_path(path))
}

function format_reason(paths: ReadonlyArray<string>, level: ReviewLevel): string {
	if (level === REDUCED_LEVEL) {
		return 'every changed path is inert, documentation, a prompt or a test; or the entire diff is at most 20 added/deleted lines'
	}

	const deciding = deciding_paths(paths)

	if (deciding.length === 0) return 'no changed paths; the default level stands'

	return `changed paths that execute or instruct: ${path_decision.format_path_list(deciding)}`
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
	format_reason,
}

export type { ReviewLevel }
export { review_level }
