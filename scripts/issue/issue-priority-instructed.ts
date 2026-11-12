import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_priority, type PriorityLevel } from './issue-priority'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// joshuafolkken/kit#6758: a person's current-turn instruction sets an issue's priority whatever its body
// declares — `--critical` and `--high` raise or lower it to that label, `--normal` takes every priority
// label off (joshuafolkken/kit#7000). The change goes on with a comment recording the instruction, so the
// rank it gains or loses reads back to the person who asked; an issue already at that level gets neither.

type InstructedResult = Exclude<RaiseResult, 'below'>

function comment_of(level: PriorityLevel, reason: string): string {
	const label = issue_priority.LABELS[level]
	const change = label === undefined ? 'Removed the priority labels' : `Applied \`${label}\``

	return `${change} on a person's instruction (\`josh issue:priority --${level}\`).\n\nReason: ${reason}`
}

// The comment goes first: a label change without it would answer `labelled` on the retry and never
// record the instruction, while a comment whose label change failed is only repeated by the retry.
async function comment_and_replace(
	issue_number: string,
	labels: ReadonlyArray<string>,
	level: PriorityLevel,
	reason: string,
): Promise<InstructedResult> {
	const is_commented = await git_gh_command.issue_try_comment(
		issue_number,
		comment_of(level, reason),
	)

	if (!is_commented) return 'failed'
	const label = issue_priority.LABELS[level]
	const is_replaced = await issue_priority_raise.replace(issue_number, labels, label)

	return is_replaced ? 'raised' : 'failed'
}

async function apply(
	issue_number: string,
	level: PriorityLevel,
	reason: string,
): Promise<InstructedResult> {
	const read = await issue_priority_raise.read_issue(issue_number)

	if (read === undefined) return 'unreadable'
	if (issue_priority_raise.is_only(read.labels, issue_priority.LABELS[level])) return 'labelled'

	return await comment_and_replace(issue_number, read.labels, level, reason)
}

const issue_priority_instructed = { apply }

export type { InstructedResult }
export { issue_priority_instructed }
