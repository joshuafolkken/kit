import { git_gh_command } from '#scripts/gh/git-gh-command'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_read } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { epic_decision } from './epic-decision'
import { epic_parse } from './epic-parse'
import { epic_read } from './epic-read'
import type { EpicSubject } from './epic-validate'

// `josh epic --decide <E> <N...> --decision-file <path|->` — record a decision about children the epic
// already tracks: the epic's `## Decisions` entry, a comment on each child, and each child's
// `needs-decision` label removed. The text is the caller's; placing it is this command's.
//
// **A rerun writes nothing twice.** The entry and each comment are looked for before they are
// written, so a run that stopped half way is finished by running it again.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface DecideInput {
	epic_number: number
	children: ReadonlyArray<number>
	decision: string
}

function format_list(numbers: ReadonlyArray<number>): string {
	return numbers.map((issue_number) => session_cite.issue(issue_number)).join(', ')
}

// A child the epic does not track is refused before anything is written: placing it is `--add`'s,
// which records the same decision in the same call.
function untracked_error(epic_number: number, untracked: ReadonlyArray<number>): string {
	return `${format_list(untracked)} not tracked by ${session_cite.issue(epic_number)}; place it with \`pnpm josh epic --add ${String(epic_number)} <N> --decision-file <path>\`. Nothing was written.`
}

// The epic the decision goes to, or why nothing is written: a record `append_decision` would refuse
// (checked before any read), an unreadable epic, or a child it does not track.
async function read_decision_target(input: DecideInput): Promise<EpicSubject | { error: string }> {
	const record_error = epic_decision.find_decision_error(input.decision)
	if (record_error !== undefined) return { error: record_error }
	const subject = await epic_read.read_subject(input.epic_number)

	if (subject === undefined) {
		return { error: `Could not read issue ${session_cite.issue(input.epic_number)}.` }
	}

	const tracked = epic_parse.parse_task_list_issue_numbers(subject.body)
	const untracked = input.children.filter((child) => !tracked.includes(child))

	return untracked.length === 0 ? subject : { error: untracked_error(input.epic_number, untracked) }
}

async function record_on_epic(subject: EpicSubject, decision: string): Promise<string> {
	const epic = session_cite.issue(subject.number)

	if (epic_decision.has_decision(subject.body, decision)) {
		return `📝 ${epic} already records this decision.`
	}

	const body = epic_decision.append_decision(subject.body ?? '', decision)

	await git_gh_command.issue_edit_body(String(subject.number), body)

	return `📝 Decision recorded in ${epic}'s \`## Decisions\`.`
}

// `undefined` when the comments could not be read: posting then risks the duplicate this exists to
// prevent, so the child is reported as not recorded and a rerun finishes it.
async function has_comment(child: number, decision: string): Promise<boolean | undefined> {
	const comments = await issue_read.parse_comments(
		await git_gh_command.issue_list_comments(String(child)),
	)

	return comments?.some((comment) => comment.body.trim() === decision.trim())
}

// The label goes only once the child carries the record, so a failed comment leaves it parked.
async function record_on_child(child: number, decision: string): Promise<boolean> {
	const has_record = await has_comment(child, decision)
	if (has_record === undefined) return false
	const is_commented =
		has_record || (await git_gh_command.issue_try_comment(String(child), decision))
	if (!is_commented) return false

	return await git_gh_command.issue_clear_label(String(child), NEEDS_DECISION_LABEL)
}

function format_child_report(total: number, failures: number): string {
	if (failures === 0) return epic_decision.format_decision_report({ total, failures })

	return `⚠️  ${String(failures)} of ${String(total)} child issue(s) could not be given the comment or lose \`${NEEDS_DECISION_LABEL}\`; rerun the same command — nothing is written twice.`
}

async function decide(input: DecideInput): Promise<number> {
	const epic = await read_decision_target(input)

	if ('error' in epic) {
		console.error(`✖ ${epic.error}`)

		return FAILURE_EXIT_CODE
	}

	console.info(await record_on_epic(epic, input.decision))
	const recorded = await Promise.all(
		input.children.map(async (child) => await record_on_child(child, input.decision)),
	)
	const failures = recorded.filter((is_recorded) => !is_recorded).length

	console.info(format_child_report(input.children.length, failures))

	return failures === 0 ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const epic_decide = {
	decide,
}

export { epic_decide }
export type { DecideInput }
