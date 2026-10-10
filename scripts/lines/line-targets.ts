import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'

// The no-argument half of `josh lines`. `josh lines <path>` answers for a file someone
// already named; a file near the limit that nobody has named yet is invisible until the gate reports
// it. This enumerates the repository's own lint-target files so the no-argument scan can report every
// one of them near the limit at once, before the first edit rather than after it.
//
// **The list is git's, not a filesystem walk, and it is not this file's own idea of a source file.**
// `git ls-files --cached --others --exclude-standard` is exactly what git would consider tracked plus
// what is new and not ignored — so a fresh file near the limit shows up and a build artifact under a
// gitignore does not, with no ignore parser of this module's own to drift from `.gitignore`. The
// extension filter is only a pre-filter that keeps the eslint probe from being handed thousands of
// non-source paths: whether a path actually has a `max-lines` budget is still `budgets_for`'s to
// decide from the project's own eslint, and a path with none is dropped from the report there.

const LINT_EXTENSIONS: ReadonlySet<string> = new Set([
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
])

// `--full-name` and the `:/` pathspec print repository-root-relative paths for the whole tree
// wherever the command runs, matching the spelling every other reading in this package resolves
// against the root; `-z` separates them with NUL so a path with an unusual character is never quoted
// or escaped, which removes any need for `core.quotePath=false`.
const WHOLE_TREE_PATHSPEC = ':/'
const LS_FILES_FLAGS: ReadonlyArray<string> = [
	'ls-files',
	'--cached',
	'--others',
	'--exclude-standard',
	'--full-name',
	'-z',
]
const NUL = '\0'

function is_lint_target(relative_path: string): boolean {
	return LINT_EXTENSIONS.has(path.extname(relative_path))
}

function split_names(output: string): ReadonlyArray<string> {
	return output.split(NUL).filter((name) => name.length > 0)
}

// The names resolve against the repository `root`, never the process cwd: `--full-name` prints them
// relative to the root wherever the command runs, so resolving against cwd would double the prefix
// and drop every file when the command is invoked from a subdirectory. `--cached` still lists a file
// deleted from the working tree but not yet staged, so a path no longer on disk is dropped — every
// consumer reads or lints the file, and a deletion in flight would otherwise fail them.
async function lint_target_files(root: string): Promise<ReadonlyArray<string>> {
	const output = await git_spawn.read([...LS_FILES_FLAGS, WHOLE_TREE_PATHSPEC])

	return split_names(output)
		.filter((name) => is_lint_target(name))
		.map((name) => path.resolve(root, name))
		.filter((file_path) => existsSync(file_path))
}

const line_targets = {
	is_lint_target,
	lint_target_files,
	split_names,
}

export { line_targets }
