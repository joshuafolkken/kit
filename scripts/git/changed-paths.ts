import { change_base } from './change-base'
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

// joshuafolkken/kit#5307: **the tracked half is measured from the tree's base, through a merge in
// progress** (`change_base.resolved_through_merge`). A merge of the default branch stopped on a
// conflict holds the default branch's files in the tree while `HEAD` is still the commit before it,
// so the diff from `HEAD`'s merge-base read everything the merge brought in as this branch's own — and
// the ship's `unplanned` precondition refused the re-detach it had itself told the lane to make. A
// base that cannot be resolved reads as before.
async function tracked_names(): Promise<string> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) return await git_command.diff_main_names()

	return await git_command.diff_names_since(base)
}

// The branch diff **plus** the untracked files. `git diff` lists neither, so a change that adds a
// new module and edits one inert file looked like an inert-only change and was handed `low`. The
// staged form needs no such addition: a file staged for addition is already in the cached diff.
async function read_changed_paths(is_staged: boolean): Promise<Array<string>> {
	if (is_staged) return to_paths(await git_command.diff_cached_names())

	const tracked = to_paths(await tracked_names())
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
