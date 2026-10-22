import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { issue_auto_ok, type AutoOkDecision } from '#scripts/issue/issue-auto-ok'
import { AUTO_OK_LABEL, has_label_name } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { z } from 'zod'
import { auto_ok_judge } from './auto-ok-judge'

// The writing half of `josh auto-ok:judge`: the agent's judgement of one open issue, recorded on it.
//
// **An applied judgement still passes the mechanical exclusions** — `issue_auto_ok.exclusion_of` is
// re-read against the labels as they stand, so a label added since the listing refuses the write
// rather than racing it. **The judgement comment lands before the labels**: a re-run skips an issue
// that already carries `auto-ok`, so a comment failing after the labels would never be retried, while
// a label failing after the comment leaves `auto-ok` off and the issue open to an explicit
// `--apply <N>` — the refusal names it, since the listing reads the comment as judged. **The
// run label lands before `auto-ok`**, so the pool never holds an opted-in issue that `backlog:next`
// would withhold as untriaged. Both answers leave the judgement comment the next listing reads as the
// record; an applied one writes nothing to the run board, which shows the issue once it is dispatched
// (joshuafolkken/kit#4133).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const UNREADABLE = 'the issue could not be read'
const CLOSED_STATE = 'CLOSED'
// The judgement comment is already posted, so the listing will not offer the issue again.
const RETRY_HINT = 're-run `pnpm josh auto-ok:judge --apply <N>` to finish it'

const issue_schema = z.object({
	state: z.string().nullish(),
	labels: z.array(issue_label_schema),
	body: z.string().nullish(),
})

interface IssueRead {
	is_closed: boolean
	labels: ReadonlyArray<string>
	body: string
}

async function read_issue(issue: string): Promise<IssueRead | undefined> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue)
	const parsed = raw === undefined ? undefined : parse_json_object_or_undefined(raw, issue_schema)

	if (parsed === undefined) return undefined

	return {
		is_closed: parsed.state === CLOSED_STATE,
		labels: parsed.labels.map((label) => label.name),
		body: parsed.body ?? '',
	}
}

// Why an apply has nothing to write: a closed issue is past the pool, and one already opted in was
// judged once — writing again would repeat the comment (joshuafolkken/kit#4097).
function settled_of(read: IssueRead): string | undefined {
	if (read.is_closed) return 'the issue is closed'

	return has_label_name(read.labels, AUTO_OK_LABEL)
		? `\`${AUTO_OK_LABEL}\` is already applied`
		: undefined
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

	const reason = `judged by backlogrun: no exclusion holds and no person's judgement is needed (${run_label})`

	if ((await record(issue, { is_applied: true, reason }, read.body)) !== SUCCESS_EXIT_CODE) {
		return FAILURE_EXIT_CODE
	}

	const problem = await apply_labels(issue, run_label)

	return problem === undefined ? SUCCESS_EXIT_CODE : refused(issue, `${problem}; ${RETRY_HINT}`)
}

async function apply(issue: string, run_label: string): Promise<number> {
	const read = await read_issue(issue)

	if (read === undefined) return refused(issue, UNREADABLE)

	const settled = settled_of(read)

	if (settled === undefined) return await apply_to(issue, run_label, read)

	console.info(`${session_cite.issue(issue)}: nothing to apply — ${settled}`)

	return SUCCESS_EXIT_CODE
}

async function decline(issue: string, reason: string): Promise<number> {
	const read = await read_issue(issue)

	if (read === undefined) return refused(issue, UNREADABLE)

	return await record(issue, { is_applied: false, reason }, read.body)
}

const auto_ok_judge_write = { apply, decline }

export { auto_ok_judge_write }
