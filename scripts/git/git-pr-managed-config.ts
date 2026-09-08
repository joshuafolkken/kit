import { managed_config_scope, type ManagedHit } from '#scripts/sync/managed-config-scope'
import { changed_paths } from './changed-paths'
import { git_command } from './git-command'

// **The tracked diff against the merge base — untracked files excluded.**
// `changed_paths.read_changed_paths(false)` appends the untracked files as well, and those are not in
// the pull request: a stray untracked file under a distributed path would put a line in the report
// asserting that *this pull request* changes a distributed file, which would be false.
//
// **What it compares is the merge base against the work tree, not against `HEAD`**, so an uncommitted
// edit to a tracked file still counts. That is deliberate rather than overlooked: `followup` runs
// straight after `josh git` has committed and pushed, so the two agree in the case this report is
// for, and where they disagree the error falls on the side of naming a path that is about to be
// committed rather than omitting one.
//
// The line splitting stays the shared helper's, so this answers from the same definition of a changed
// path as the review level and the eval scope.
async function read_branch_paths(): Promise<Array<string>> {
	return changed_paths.to_paths(await git_command.diff_main_names())
}

const REPORT_HEADING =
	'This pull request changes files that `josh sync` distributes to every consumer project.'
const REPORT_PATHS_HEADING = 'Distributed paths in this diff:'

function build_report(hits: ReadonlyArray<ManagedHit>): Array<string> {
	return [REPORT_HEADING, REPORT_PATHS_HEADING, managed_config_scope.format_hits(hits)]
}

// **This reports; it does not stop the merge** (joshuafolkken/kit#1592). joshuafolkken/kit#1578 made
// it a confirmation gate that exited non-zero ahead of the CI wait, and in kit the condition it tests
// is nearly always true: kit is the distribution source, so every change to `CLAUDE.md`, to
// `prompts/`, to `.claude/skills/` or to the distributed part of `docs/` is by definition a change to
// a distributed path. Measured on `epicrun #1413`, **two of three children stopped here** — and in
// both the distributed file was what the Issue's own acceptance criteria had ordered changed. The
// gate was not catching an unintended edit; it was stopping the work.
//
// **There is deliberately no branch on which repository this is.** The alternative — stop in a
// consumer, where editing a distributed file really is the mistake `CLAUDE.md` → "Route
// distributed-doc / config changes upstream to kit" names, and stay quiet in kit — was weighed and
// rejected on joshuafolkken/kit#1592: it needs a distribution-source test this package does not have,
// no case is recorded of the gate saving a consumer's work, and the report below reaches a consumer's
// reader just as well. `managed_config_scope` matches both ends of every mapping and distinguishes no
// repository, and that property is kept rather than worked around.
//
// **What is left is the signal without the stop.** The claimed paths and the list that claimed each
// one go into the completion notification and into the completion report on the Issue, so a
// distributed change is still impossible to miss after the fact.
async function handle_managed_config_changes(input: {
	should_merge: boolean
}): Promise<Array<string>> {
	// **Nothing to report when nothing merges.** `--no-merge` ends with the pull request open for a
	// person to look at, and the distribution has not happened yet; the report belongs to the run that
	// actually lands the change on the default branch.
	if (!input.should_merge) return []

	const hits = managed_config_scope.find_managed_paths(await read_branch_paths())

	if (hits.length === 0) return []

	return build_report(hits)
}

const git_pr_managed_config = {
	handle_managed_config_changes,
	build_report,
}

export { git_pr_managed_config }
