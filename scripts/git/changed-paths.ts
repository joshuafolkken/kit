import { git_command } from './git-command'

// The set of changed paths a mechanical, path-driven decision is made from.
//
// `josh review:level` asks this same question of the same tree (which level to review at), and a
// second copy would let a caller disagree about what "changed" means.

function to_paths(raw: string): Array<string> {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
}

// The branch diff **plus** the untracked files. `git diff` lists neither, so a change that adds a
// new module and edits one inert file looked like an inert-only change and was handed `low`. The
// staged form needs no such addition: a file staged for addition is already in the cached diff.
async function read_changed_paths(is_staged: boolean): Promise<Array<string>> {
	if (is_staged) return to_paths(await git_command.diff_cached_names())

	const tracked = to_paths(await git_command.diff_main_names())
	const untracked = to_paths(await git_command.untracked_names())

	return [...tracked, ...untracked]
}

// The same reading against any commit rather than the change base — the change since the tree a
// test-read map was recorded on.
async function read_changed_since(commit: string): Promise<Array<string>> {
	const tracked = to_paths(await git_command.diff_names_since(commit))
	const untracked = to_paths(await git_command.untracked_names())

	return [...new Set([...tracked, ...untracked])]
}

// The paths among `paths` the tree of `commit` held. An empty list asks git nothing, since
// `ls-tree` with no path lists the whole tree.
async function read_held_at(commit: string, paths: ReadonlyArray<string>): Promise<Array<string>> {
	if (paths.length === 0) return []

	return to_paths(await git_command.tree_names_at(commit, paths))
}

const changed_paths = { read_changed_paths, read_changed_since, read_held_at, to_paths }

export { changed_paths }
