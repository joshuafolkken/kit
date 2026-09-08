import { managed_config_scope, type ManagedHit } from '#scripts/sync/managed-config-scope'
import { changed_paths } from './changed-paths'
import { git_command } from './git-command'
import { git_gh_command } from './git-gh-command'
import { git_pr_confirmation, type TelegramContext } from './git-pr-confirmation'

// **The tracked diff against the merge base — untracked files excluded.**
// `changed_paths.read_changed_paths(false)` appends the untracked files as well, and those are not in
// the pull request: a stray untracked file under a distributed path would have blocked the merge with
// a body asserting that *this pull request* changes a distributed file, which would be false.
//
// **What it compares is the merge base against the work tree, not against `HEAD`**, so an uncommitted
// edit to a tracked file still counts. That is deliberate rather than overlooked: `followup` runs
// straight after `josh git` has committed and pushed, so the two agree in the case this gate is for,
// and where they disagree the error falls on the side of stopping — which is the direction a
// confirmation gate should fail in.
//
// The line splitting stays the shared helper's, so this answers from the same definition of a changed
// path as the review level and the eval scope.
async function read_branch_paths(): Promise<Array<string>> {
	return changed_paths.to_paths(await git_command.diff_main_names())
}

const BLOCKER_HEADING =
	'This pull request changes files that `josh sync` distributes to every consumer project.'
const BLOCKER_PATHS_HEADING = 'Distributed paths in this diff:'
const BLOCKER_INSTRUCTION =
	'Review the changes, then re-run `pnpm josh followup` with ' +
	'--managed-config-ignore-reason "<reason>" to proceed.'

const IGNORE_HEADING =
	'A `josh sync`-distributed file was changed and the managed config-file gate was bypassed.'

// The audit note a bypassed run carries into its completion notification. Without it a run that
// distributed a change reports exactly like one that touched nothing distributed.
const MANAGED_CONFIG_BYPASS_NOTE =
	'Managed config-file gate bypassed; a josh sync-distributed file was changed.'

function build_blocker_body(hits: ReadonlyArray<ManagedHit>): string {
	return [
		BLOCKER_HEADING,
		'',
		BLOCKER_PATHS_HEADING,
		managed_config_scope.format_hits(hits),
		'',
		BLOCKER_INSTRUCTION,
	].join('\n')
}

function build_ignore_comment(reason: string, hits: ReadonlyArray<ManagedHit>): string {
	return [
		IGNORE_HEADING,
		`Reason: ${reason.trim()}`,
		BLOCKER_PATHS_HEADING,
		managed_config_scope.format_hits(hits),
	].join('\n')
}

// **The gate is a read of the diff, so it runs before the CI wait rather than after it.** The prose
// it replaces said "after CI status checks complete", which spent the whole wait on a run that was
// going to stop anyway; nothing in the answer depends on a check result (joshuafolkken/kit#1578).
//
// **Returns an audit note rather than a boolean** so a bypassed run reads like the AI-review bypass
// it is modelled on: the reason lands on the pull request as a comment, and the note is folded into
// the completion notification.
async function handle_managed_config_changes(input: {
	branch_name: string
	ignore_reason: string | undefined
	context: TelegramContext
	should_merge: boolean
}): Promise<Array<string>> {
	// **Nothing to gate when nothing merges.** `--no-merge` already ends with the pull request open
	// for a person to look at, which is what this gate asks for; stopping there would only withhold
	// the completion notification and the wrap-up from a run that was never going to distribute.
	if (!input.should_merge) return []

	const hits = managed_config_scope.find_managed_paths(await read_branch_paths())

	if (hits.length === 0) return []

	if (git_pr_confirmation.has_ignore_reason(input.ignore_reason)) {
		await git_gh_command.pr_comment(
			input.branch_name,
			build_ignore_comment(input.ignore_reason, hits),
		)

		return [MANAGED_CONFIG_BYPASS_NOTE]
	}

	const body = build_blocker_body(hits)

	await git_pr_confirmation.notify_confirmation({ context: input.context, body })

	throw new Error(body)
}

const git_pr_managed_config = {
	handle_managed_config_changes,
	build_blocker_body,
	build_ignore_comment,
}

export { git_pr_managed_config, MANAGED_CONFIG_BYPASS_NOTE }
