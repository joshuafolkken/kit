import { git_spawn } from './git-spawn'

// Whether the git command `arguments_` exits zero — for a question git answers with its exit code.
async function succeeds(arguments_: Array<string>): Promise<boolean> {
	try {
		await git_spawn.read(arguments_)

		return true
	} catch {
		return false
	}
}

// Whether `of` contains `sha` (`git merge-base --is-ancestor`); a commit git does not know is `false`,
// the same answer as one off the history — the lane entry and the pre-merge check both refuse either.
async function is_ancestor(sha: string, of: string): Promise<boolean> {
	return await succeeds(['merge-base', '--is-ancestor', sha, of])
}

const git_ancestor = { is_ancestor, succeeds }

export { git_ancestor }
