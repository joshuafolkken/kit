import { createHash } from 'node:crypto'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { issue_priority_raise } from './issue-priority-raise'

// joshuafolkken/kit#5848: the write half of a fold, which the assessor once chained by hand. The body
// is written only while it still reads as the assessment saw it, the body's priority floor is applied
// as a body edit applies no label, and the fold counts only once a re-read carries the written body.

type ApplyResult =
	'applied' | 'changed' | 'unreadable' | 'write-failed' | 'priority-failed' | 'unverified'

interface FoldWrite {
	issue_number: string
	existing_body: string
	comment_fingerprint: string
	body: string
}

const comment_stamp_schema = z.looseObject({ id: z.number(), updated_at: z.string() })

// GitHub hands back a body edited in the browser with CRLF line ends, and `gh` drops the trailing
// newline, so neither difference is a change.
function normalize(text: string): string {
	return text.replaceAll('\r\n', '\n').trimEnd()
}

async function reads_as(issue_number: string, expected: string): Promise<boolean | undefined> {
	const current = await git_gh_command.issue_get_body(issue_number)

	return current === undefined ? undefined : normalize(current) === normalize(expected)
}

// joshuafolkken/kit#5891: one token for the comment thread as it stands — each comment's id and its
// `updated_at` enter the digest, so an added, edited or deleted comment changes it.
async function comment_fingerprint(issue_number: string): Promise<string | undefined> {
	const raw = await git_gh_command.issue_list_comments(issue_number)
	const listing = raw === undefined ? undefined : read_json_listing(raw, comment_stamp_schema)

	if (listing?.kind !== 'read') return undefined
	const stamps = listing.rows.map((comment) => [comment.id, comment.updated_at])

	return createHash('sha256').update(JSON.stringify(stamps)).digest('hex')
}

// A comment added or edited after the assessment can change the decision as surely as a body edit.
async function check_unchanged(
	fold: Pick<FoldWrite, 'issue_number' | 'existing_body' | 'comment_fingerprint'>,
): Promise<ApplyResult | undefined> {
	const checks = [
		await reads_as(fold.issue_number, fold.existing_body),
		await comment_fingerprint(fold.issue_number),
	]

	if (checks.includes(undefined)) return 'unreadable'

	return checks[0] === true && checks[1] === fold.comment_fingerprint ? undefined : 'changed'
}

async function raise_floor(issue_number: string): Promise<ApplyResult | undefined> {
	const raised = await issue_priority_raise.raise(issue_number)

	return issue_priority_raise.is_failure(raised) ? 'priority-failed' : undefined
}

async function write(fold: FoldWrite): Promise<ApplyResult | undefined> {
	try {
		await git_gh_command.issue_edit_body(fold.issue_number, fold.body)
	} catch {
		return 'write-failed'
	}

	return await raise_floor(fold.issue_number)
}

// joshuafolkken/kit#6643: a body that already reads as the fold is this fold's own earlier write — a
// rerun after the split-child record failed — so only the priority floor is left to apply.
async function finish_prior_write(
	fold: FoldWrite,
	unchanged: ApplyResult | undefined,
): Promise<ApplyResult | undefined> {
	if (unchanged !== 'changed' || (await reads_as(fold.issue_number, fold.body)) !== true) {
		return undefined
	}

	return (await raise_floor(fold.issue_number)) ?? 'applied'
}

async function apply(fold: FoldWrite): Promise<ApplyResult> {
	const unchanged = await check_unchanged(fold)
	const settled = (await finish_prior_write(fold, unchanged)) ?? unchanged ?? (await write(fold))

	if (settled !== undefined) return settled

	return (await reads_as(fold.issue_number, fold.body)) === true ? 'applied' : 'unverified'
}

const issue_fold_apply = { apply, check_unchanged, comment_fingerprint }

export type { ApplyResult, FoldWrite }
export { issue_fold_apply }
