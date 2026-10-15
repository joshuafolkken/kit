import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { issue_auto_ok, type AutoOkDecision } from '#scripts/issue/issue-auto-ok'
import { issue_cite } from '#scripts/issue/issue-cite'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { z } from 'zod'
import { auto_ok_judge } from './auto-ok-judge'

// The writing half of `josh auto-ok:judge`: the agent's judgement of one open issue, recorded on it.
//
// **An applied judgement still passes the mechanical exclusions** — `issue_auto_ok.exclusion_of` is
// re-read against the labels as they stand, so a label added since the listing refuses the write
// rather than racing it. **The run label lands before `auto-ok`**, so the pool never holds an opted-in
// issue that `backlog:next` would withhold as untriaged. Both answers leave the judgement comment the
// next listing reads as the record, and an applied one is a `note` on the board's 📌.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const UNREADABLE = 'the issue could not be read'

const issue_schema = z.object({ labels: z.array(issue_label_schema), body: z.string().nullish() })

interface IssueRead {
	labels: ReadonlyArray<string>
	body: string
}

async function read_issue(issue: string): Promise<IssueRead | undefined> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue)
	const parsed = raw === undefined ? undefined : parse_json_object_or_undefined(raw, issue_schema)

	if (parsed === undefined) return undefined

	return { labels: parsed.labels.map((label) => label.name), body: parsed.body ?? '' }
}

async function apply_labels(issue: string, run_label: string): Promise<string | undefined> {
	for (const label of [run_label, AUTO_OK_LABEL]) {
		// eslint-disable-next-line no-await-in-loop -- the run label must land before `auto-ok`
		const write = await git_gh_command.issue_apply_label(issue, label)

		if (!write.is_applied) return `could not apply \`${label}\`: ${write.reason}`
	}

	return undefined
}

async function record(issue: string, decision: AutoOkDecision, body: string): Promise<number> {
	try {
		await git_gh_command.issue_comment(issue, auto_ok_judge.comment_of(decision, body))
	} catch {
		console.error(`could not comment the judgement on ${session_cite.issue(issue)}`)

		return FAILURE_EXIT_CODE
	}

	console.info(issue_auto_ok.line_of(decision))

	return SUCCESS_EXIT_CODE
}

function refused(issue: string, problem: string): number {
	console.error(`${session_cite.issue(issue)}: ${problem}`)

	return FAILURE_EXIT_CODE
}

async function apply_to(issue: string, run_label: string, read: IssueRead): Promise<number> {
	const exclusion = issue_auto_ok.exclusion_of(read.labels)

	if (exclusion !== undefined) return refused(issue, issue_auto_ok.line_of(exclusion))

	const problem = await apply_labels(issue, run_label)

	if (problem !== undefined) return refused(issue, problem)

	const reason = `judged by backlogrun: no exclusion holds and no person's judgement is needed (${run_label})`

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.NOTE,
		`${issue_cite.plain(issue)} auto-ok applied (${run_label})`,
	)

	return await record(issue, { is_applied: true, reason }, read.body)
}

async function apply(issue: string, run_label: string): Promise<number> {
	const read = await read_issue(issue)

	if (read === undefined) return refused(issue, UNREADABLE)

	return await apply_to(issue, run_label, read)
}

async function decline(issue: string, reason: string): Promise<number> {
	const read = await read_issue(issue)

	if (read === undefined) return refused(issue, UNREADABLE)

	return await record(issue, { is_applied: false, reason }, read.body)
}

const auto_ok_judge_write = { apply, decline }

export { auto_ok_judge_write }
