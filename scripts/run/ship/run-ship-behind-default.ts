import { git_command } from '#scripts/git/git-command'

// Whether origin's default branch holds a commit the branch lacks — the move the sync stage merges in.

async function commits_behind(): Promise<number> {
	const default_branch = await git_command.get_default_branch()

	return await git_command.commit_count_beyond('HEAD', `origin/${default_branch}`)
}

// Read off the remote-tracking ref as it stands, after a fetch that already ran. An unreadable count
// reads as moved, so the skipped merge is still said on the ship log.
async function is_behind_default(): Promise<boolean> {
	try {
		return (await commits_behind()) > 0
	} catch {
		return true
	}
}

// Fetched first: the ref was last read when the run started, and the sync stage merges what origin
// holds now. A failed fetch or count reads as unmoved, so a caller deciding whether to skip work keeps
// doing it.
async function is_merge_ahead(): Promise<boolean> {
	try {
		await git_command.fetch_branch(await git_command.get_default_branch())

		return (await commits_behind()) > 0
	} catch {
		return false
	}
}

const run_ship_behind_default = { is_behind_default, is_merge_ahead }

export { run_ship_behind_default }
