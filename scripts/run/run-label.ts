import { git_followup_label } from '#scripts/followup/git-followup-label'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'

// **The `in-progress` marker belongs to the commands that open and release a run**, so no manifest
// spells the label's calls and none can forget it: `run:entry` applies it the moment the tree is held
// and the budget allows the run, and `run:release` takes it back off.
//
// **Neither half ever fails the command it rides on.** The hold is the guard and the label only
// reports it, so a refused write is warned about by name — with the call that finishes it by hand —
// and the run's own verdict stands.

const MARK_RECOVERY = "gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=in-progress'"
const UNMARK_RECOVERY = 'gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress'

function warn(action: string, issue: string, recovery: string): void {
	console.warn(
		`⚠ could not ${action} \`in-progress\` on ${session_cite.issue(issue)} — run by hand: ${recovery}`,
	)
}

// `issue_add_label` creates the label when the repository lacks it (`lane-dispatch.ts`), so no
// separate provisioning call is made here.
async function mark(issue: string): Promise<boolean> {
	const is_marked = await git_gh_command.issue_add_label(issue, IN_PROGRESS_LABEL)

	if (!is_marked) warn('apply', issue, MARK_RECOVERY)

	return is_marked
}

// The removal is `followup`'s own — read first, removed only when present, under the stored
// casing — so an issue that never carried the label is never written to.
async function unmark(issue: string): Promise<boolean> {
	try {
		await git_followup_label.strip_in_progress(issue)

		return true
	} catch {
		warn('remove', issue, UNMARK_RECOVERY)

		return false
	}
}

const run_label = {
	mark,
	unmark,
}

export { run_label }
