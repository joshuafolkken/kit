import { readFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { line_targets } from '#scripts/lines/line-targets'

// The target-file selection of `josh refactor:scan` — the priority `prompts/refactoring.md` §4.1
// used to spell out in prose (joshuafolkken/kit#2180). The scope is the same reading every scoped
// command decides from — the branch diff plus the untracked files (`changed-paths.ts`) — and only
// when that is empty does it fall back to `scripts/`, so a run on a clean `main` still has something
// to scan rather than reporting nothing.

// The `scripts/` fallback lives under this directory, root-relative — the same spelling
// `line-targets.ts` resolves against the repository root.
const SCRIPTS_DIR = 'scripts'
// The three exclusions §4.1 names: demo material, the story routes, and any file that opts out at its
// top. Refactoring a demo or a story would change an example rather than the code it illustrates.
const DEMO_MARKER = 'demo'
const STORIES_DIR = 'src/routes/stories'
// The opt-out marker, matched at the very top of the file so a mention of it lower down is not read
// as one. `CLAUDE.md` documents it as the file-level refactoring exclusion.
const REFACTOR_IGNORE_MARKER = '/* @refactor-ignore */'

// A path segment named `demo`, or a filename that carries it, is demo material. Split on the forward
// slash git prints, so a directory named `demo` and a file `foo.demo.ts` are both caught.
function is_path_excluded(relative_path: string): boolean {
	const segments = relative_path.split('/')

	if (segments.some((segment) => segment.includes(DEMO_MARKER))) return true

	return relative_path.includes(STORIES_DIR)
}

// The file-level opt-out is read from the file's own head rather than its path: `trimStart` lets a
// leading blank line or shebang-free preamble still count, and a marker deeper in the file is ignored.
function has_ignore_marker(source: string): boolean {
	return source.trimStart().startsWith(REFACTOR_IGNORE_MARKER)
}

// A path that is gone or unreadable is not something to scan, so it is treated as opted out rather
// than crashing the whole scan on one bad entry.
function is_ignored_file(absolute_path: string): boolean {
	try {
		return has_ignore_marker(readFileSync(absolute_path, 'utf8'))
	} catch {
		return true
	}
}

// The changed set wins; the `scripts/` fallback is used only when nothing changed. `undefined` and an
// empty array are the same answer here — both mean "no change to scan" — because a scan of nothing is
// never the intended result, unlike a scoped re-check where it means "narrowed to nothing".
function select_scope(
	changed: ReadonlyArray<string>,
	fallback_files: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return changed.length > 0 ? changed : fallback_files
}

// Only lint-target source files, only those neither path-excluded nor opted out.
function keep_target(root: string, absolute_path: string): boolean {
	const relative_path = path.relative(root, absolute_path)

	if (!line_targets.is_lint_target(relative_path) || is_path_excluded(relative_path)) return false

	return !is_ignored_file(absolute_path)
}

function scripts_files(root: string, all_files: ReadonlyArray<string>): ReadonlyArray<string> {
	const scripts_root = path.resolve(root, SCRIPTS_DIR)

	return all_files.filter((file) => file.startsWith(`${scripts_root}${path.sep}`))
}

async function changed_absolute(root: string): Promise<ReadonlyArray<string>> {
	try {
		const relative = await changed_paths.read_changed_paths(false)

		return relative.map((name) => path.resolve(root, name))
	} catch {
		return []
	}
}

// The seed set §4.3 expands from: the changed files, or `scripts/` when nothing changed, filtered to
// lint-target source files that are not excluded.
async function collect_targets(root: string): Promise<ReadonlyArray<string>> {
	const changed = await changed_absolute(root)
	const all_files = await line_targets.lint_target_files(root)
	const scope = select_scope(changed, scripts_files(root, all_files))

	return scope.filter((absolute_path) => keep_target(root, absolute_path))
}

const refactor_targets = {
	collect_targets,
	has_ignore_marker,
	is_path_excluded,
	keep_target,
	scripts_files,
	select_scope,
}

export { refactor_targets }
