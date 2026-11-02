import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_priority_raise } from './issue-priority-raise'

// joshuafolkken/kit#5848: the write half of a fold, which the assessor once chained by hand. The body
// is written only while it still reads as the assessment saw it, the body's priority floor is applied
// as a body edit applies no label, and the fold counts only once a re-read carries the written body.

type ApplyResult =
	'applied' | 'changed' | 'unreadable' | 'write-failed' | 'priority-failed' | 'unverified'

interface FoldWrite {
	issue_number: string
	existing_body: string
	body: string
}

// GitHub hands back a body edited in the browser with CRLF line ends, and `gh` drops the trailing
// newline, so neither difference is a change.
function normalize(text: string): string {
	return text.replaceAll('\r\n', '\n').trimEnd()
}

async function reads_as(issue_number: string, expected: string): Promise<boolean | undefined> {
	const current = await git_gh_command.issue_get_body(issue_number)

	return current === undefined ? undefined : normalize(current) === normalize(expected)
}

async function check_unchanged(fold: FoldWrite): Promise<ApplyResult | undefined> {
	const is_unchanged = await reads_as(fold.issue_number, fold.existing_body)

	if (is_unchanged === undefined) return 'unreadable'

	return is_unchanged ? undefined : 'changed'
}

async function write(fold: FoldWrite): Promise<ApplyResult | undefined> {
	try {
		await git_gh_command.issue_edit_body(fold.issue_number, fold.body)
	} catch {
		return 'write-failed'
	}

	const raised = await issue_priority_raise.raise(fold.issue_number)

	return issue_priority_raise.is_failure(raised) ? 'priority-failed' : undefined
}

async function apply(fold: FoldWrite): Promise<ApplyResult> {
	const refusal = (await check_unchanged(fold)) ?? (await write(fold))

	if (refusal !== undefined) return refusal

	return (await reads_as(fold.issue_number, fold.body)) === true ? 'applied' : 'unverified'
}

const issue_fold_apply = { apply }

export type { ApplyResult, FoldWrite }
export { issue_fold_apply }
