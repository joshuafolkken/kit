import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { git_stash } from '#scripts/git/stash/git-stash'
import { error_text } from '#scripts/lib/error-message'

// What `run_preflight` reads of this checkout's own tree before it decides.

interface TreeState {
	branch: string
	default_branch: string
	is_dirty: boolean
	// A clean issue branch with no commit beyond the default branch — what `run:entry` leaves when it
	// stops after switching the checkout to `<N>-<slug>` (joshuafolkken/kit#8983). It holds no work, as
	// `read_candidate` reads such a branch, so it counts as standing on the default branch.
	is_bare?: boolean
}

// Dirty means work `stash:push` would set aside: a tree whose only change is the observation ledger
// would otherwise be told to stash, get `clean`, and be told to stash again. Unreadable is dirty, as
// in `run_hold.is_tree_dirty`.
async function has_stashable_work(): Promise<boolean> {
	try {
		return await git_stash.has_stashable_changes()
	} catch (error) {
		error_text.trace_swallowed('run_preflight.has_stashable_work', error)

		return true
	}
}

// An unreadable count is not bare, so the tree is reclaimed as before.
async function is_bare_issue_branch(tree: TreeState): Promise<boolean> {
	if (tree.is_dirty || git_branch.issue_from_branch(tree.branch) === undefined) return false

	try {
		const base = await git_command.default_branch_reference()

		return (await git_command.commit_count_beyond(base, 'HEAD')) === 0
	} catch (error) {
		error_text.trace_swallowed('run_preflight.is_bare_issue_branch', error)

		return false
	}
}

async function read_tree_state(): Promise<TreeState> {
	const [is_dirty, current, default_branch] = await Promise.all([
		has_stashable_work(),
		git_command.branch(),
		git_command.get_default_branch(),
	])
	const tree = { branch: current, default_branch, is_dirty }

	return { ...tree, is_bare: await is_bare_issue_branch(tree) }
}

const run_preflight_tree = { read_tree_state }

export type { TreeState }
export { run_preflight_tree }
