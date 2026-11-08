import { git_gh_command } from '#scripts/gh/git-gh-command'
import { has_label_name, PRIORITY_CRITICAL_LABEL } from './issue-labels'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// joshuafolkken/kit#6758: a person's current-turn instruction makes an issue critical whatever its body
// declares. The label goes on with a comment recording the instruction, so the rank it gains reads back
// to the person who asked; an issue already critical gets neither.

type CriticalResult = Exclude<RaiseResult, 'below'>

function comment_of(reason: string): string {
	return `Applied \`${PRIORITY_CRITICAL_LABEL}\` on a person's instruction (\`josh issue:priority --critical\`).\n\nReason: ${reason}`
}

async function label_and_comment(issue_number: string, reason: string): Promise<CriticalResult> {
	const is_labelled = await git_gh_command.issue_add_label(issue_number, PRIORITY_CRITICAL_LABEL)

	if (!is_labelled) return 'failed'
	const is_commented = await git_gh_command.issue_try_comment(issue_number, comment_of(reason))

	return is_commented ? 'raised' : 'failed'
}

async function apply(issue_number: string, reason: string): Promise<CriticalResult> {
	const read = await issue_priority_raise.read_issue(issue_number)

	if (read === undefined) return 'unreadable'
	if (has_label_name(read.labels, PRIORITY_CRITICAL_LABEL)) return 'labelled'

	return await label_and_comment(issue_number, reason)
}

const issue_priority_critical = { apply }

export type { CriticalResult }
export { issue_priority_critical }
