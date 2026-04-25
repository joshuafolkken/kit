import { git_gh_command } from './git-gh-command'
import { pr_info_schema } from './schemas'

const MERGE_STATE_DIRTY = 'dirty'
const MERGE_STATE_BLOCKED = 'blocked'
const MERGEABLE_CONFLICTING = 'CONFLICTING'
const CONFLICT_MESSAGE = 'This branch has conflicts that must be resolved.'
const WARNING_TITLE = '⚠️  Warning: PR has conflicts or merge issues'

type MergeableValue = boolean | string | null | undefined

function is_mergeable_conflicting(mergeable: MergeableValue): boolean {
	if (typeof mergeable === 'string') {
		return mergeable === MERGEABLE_CONFLICTING
	}

	return mergeable === false
}

function is_merge_state_blocked(merge_state_status: string | null | undefined): boolean {
	if (merge_state_status === undefined || merge_state_status === null) {
		return false
	}

	const normalized = merge_state_status.toLowerCase()

	return normalized === MERGE_STATE_DIRTY || normalized === MERGE_STATE_BLOCKED
}

function parse_pr_info(
	pr_info_json: string,
): { is_mergeable: MergeableValue; merge_state_status: string | null | undefined } | undefined {
	try {
		const result = pr_info_schema.safeParse(JSON.parse(pr_info_json))
		if (!result.success) return undefined

		return { is_mergeable: result.data.mergeable, merge_state_status: result.data.mergeStateStatus }
	} catch {
		return undefined
	}
}

function check_conflict_conditions(
	is_mergeable: MergeableValue,
	merge_state_status: string | null | undefined,
): boolean {
	if (is_mergeable_conflicting(is_mergeable)) {
		return true
	}

	return is_merge_state_blocked(merge_state_status)
}

function has_conflicts(pr_info_json: string): boolean {
	const pr_info = parse_pr_info(pr_info_json)

	if (pr_info === undefined) {
		return false
	}

	return check_conflict_conditions(pr_info.is_mergeable, pr_info.merge_state_status)
}

function display_conflict_warning(): void {
	console.error('')
	console.error(WARNING_TITLE)
	console.error('')
	console.error(CONFLICT_MESSAGE)
	console.error('Please resolve the conflicts and update the PR.')
	console.error('')
}

async function get_pr_info_safe(branch_name: string): Promise<string | undefined> {
	try {
		const pr_info_json = await git_gh_command.pr_view(branch_name)

		return pr_info_json.length > 0 ? pr_info_json : undefined
	} catch {
		return undefined
	}
}

async function check_pr_status_for_errors(branch_name: string): Promise<void> {
	const pr_info_json = await get_pr_info_safe(branch_name)
	if (pr_info_json === undefined) return

	if (has_conflicts(pr_info_json)) {
		display_conflict_warning()
		process.exit(1)
	}
}

const git_conflict = {
	check_pr_status_for_errors,
}

export { git_conflict }
