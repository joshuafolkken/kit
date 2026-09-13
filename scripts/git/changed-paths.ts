import { git_command } from './git-command'

// The set of changed paths a mechanical, path-driven decision is made from.
//
// `josh review:level` asks this same question of the same tree (which level to review at), and a
// second copy would let a caller disagree about what "changed" means. joshuafolkken/kit#907: sharing
// this reading is the moment it stopped being one command's private helper.

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

const changed_paths = { read_changed_paths, to_paths }

export { changed_paths }
