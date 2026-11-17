import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'

// **Whether the lane has made its first edit** (joshuafolkken/kit#7729): its tree differs from its base —
// a commit, a tracked change or an untracked file. Before it, an oversize plan can still be split with
// nothing to throw away; after it, the lane is finished whole (joshuafolkken/kit#7183). An unresolved
// base reads as edited, so an unread tree never splits a lane that may have started.
async function is_edited(): Promise<boolean> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) return true
	const [tracked, untracked] = await Promise.all([
		git_command.diff_numstat_since(base),
		git_command.untracked_names(),
	])

	return tracked.trim() !== '' || untracked.trim() !== ''
}

const lane_tree_edit = { is_edited }

export { lane_tree_edit }
