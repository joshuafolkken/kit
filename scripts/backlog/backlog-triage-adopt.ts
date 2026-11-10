import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { epic_decide } from '#scripts/epic/epic-decide'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import type { IssueComment } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_park } from '#scripts/run/park/run-park'
import { run_park_body, type ApprovalRange } from '#scripts/run/park/run-park-body'
import { backlog_triage_approval } from './backlog-triage-approval'
import { backlog_triage_park } from './backlog-triage-park'

// `josh backlog:triage --apply <N> --adopt <k> --reason <text>` — a parent takes option `<k>` of a
// parked child's park in one call (joshuafolkken/kit#6670): the decision recorded in the tracking
// epic's `## Decisions` and on the child (`epic --decide`'s path, which clears `needs-decision`), the
// park record cleared (`run:park --clear`'s), then the child requeued (`run:add --retry`: a park left
// for a person is marked done in the run, so a plain add refuses it).
//
// **Every read comes before the first write**: the latest park body that meets the schema
// (`run_park_body`) refuses a park with no recommendation, an unlisted option and a tier C option, and
// the child needs exactly one tracking epic and a backlogrun must hold the carry record here (`run:add`
// refuses without one), so a refusal leaves nothing written. `epic --decide`
// skips an entry or a comment already there, so a re-run after a later failure records nothing twice.
// An option carrying a size-approval range first writes the approval (`backlog-triage-approval.ts`).
//
// **An option needing the parent's own action is taken before it is adopted** (joshuafolkken/kit#7001):
// adopting it records a choice but files, closes or edits nothing, so a requeued child hits the same
// wall again. Without `--done <what was done>` it is refused and nothing is written — the child stays
// parked and `run:board` keeps the park's row with its parent-action note; with it, the decision
// records the action.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const OPTION_SHAPE = /^[1-9]\d*$/u
const USAGE =
	'Usage: josh backlog:triage --apply <N> --adopt <k> --reason <text> [--done <the parent action taken>]'
const DECIDE_FAILED = 'could not record the decision; nothing after it was written'
const REQUEUE_FAILED_HEAD = 'decision recorded and park cleared, but'
const NO_RUN = 'no backlogrun is running here to requeue it; nothing was written'

const OPTIONS = {
	apply: { type: 'string' },
	adopt: { type: 'string' },
	reason: { type: 'string' },
	done: { type: 'string' },
} as const

interface AdoptRequest {
	issue: string
	option: number
	reason: string
	done: string
}

type EpicRead = { epic: number } | { problem: string }

interface ParkFound {
	comments: ReadonlyArray<IssueComment>
	range: ApprovalRange | undefined
}

interface AdoptRead {
	epic: number
	park: ParkFound
}

type Values = NonNullable<ReturnType<typeof cli_flags.values_of<typeof OPTIONS>>>

function text_of(value: string | undefined): string {
	return value?.trim() ?? ''
}

function option_of(text: string): number | undefined {
	return OPTION_SHAPE.test(text) ? Number(text) : undefined
}

function request_of(values: Values): AdoptRequest | undefined {
	const issue = text_of(values.apply)
	const option = option_of(text_of(values.adopt))
	const reason = text_of(values.reason)

	if (option === undefined || reason === '') return undefined
	const done = text_of(values.done)

	return issue_number_shape.is_issue_number(issue) ? { issue, option, reason, done } : undefined
}

// `--done` goes with exactly the options needing the parent's own action, so the decision never
// records an action no option asked for.
function action_problem(body: string, request: AdoptRequest): string | undefined {
	const { option, done } = request
	const needed = run_park_body.parent_action(body, option)
	const isGiven = done !== ''

	if (needed === isGiven) return undefined

	return needed
		? `option ${String(option)} needs the parent's own action; take it, then re-run with --done "<what was done>" — nothing was written and the child stays parked`
		: `option ${String(option)} needs no parent action; re-run without --done — nothing was written`
}

function refused(issue: string, problem: string): number {
	console.error(`${session_cite.issue(issue)}: ${problem}`)

	return FAILURE_EXIT_CODE
}

async function park_of(request: AdoptRequest): Promise<ParkFound | { problem: string }> {
	const park = await backlog_triage_park.read(request.issue)

	if ('problem' in park) return park
	const problem =
		run_park_body.adopt_problem(park.body, request.option) ?? action_problem(park.body, request)

	if (problem !== undefined) return { problem }

	return { comments: park.comments, range: run_park_body.approval_range(park.body, request.option) }
}

function epics_problem(count: number): string {
	return `${String(count)} epics track it; record the decision with \`josh epic --decide\``
}

async function epic_of(issue: string): Promise<EpicRead> {
	try {
		const epics = await epic_blocked_by.listing_epics(issue)
		const [epic] = epics

		return epic === undefined || epics.length > 1
			? { problem: epics_problem(epics.length) }
			: { epic }
	} catch (error) {
		return { problem: `could not read the tracking epic: ${error_text.message_of(error)}` }
	}
}

async function run_problem(): Promise<string | undefined> {
	const git_directory = await run_carry.repository_directory()

	if (git_directory === undefined) return NO_RUN
	const read = run_carry.read_carry(run_carry.carry_path(git_directory))

	return read.kind === 'carried' ? undefined : NO_RUN
}

async function read_of(request: AdoptRequest): Promise<AdoptRead | { problem: string }> {
	const problem = await run_problem()

	if (problem !== undefined) return { problem }
	const park = await park_of(request)

	if ('problem' in park) return park
	const read = await epic_of(request.issue)

	return 'problem' in read ? read : { epic: read.epic, park }
}

// The size approval the adopted option carries, written first; its json path, or `undefined`.
async function approval_of(request: AdoptRequest, park: ParkFound): Promise<string | undefined> {
	const { issue, reason } = request
	const { comments, range } = park

	if (range === undefined) return undefined

	return await backlog_triage_approval.write({ issue, reason, range, comments })
}

function decision_of(request: AdoptRequest): string {
	const { issue, option, reason, done } = request
	const adopted = `adopted park option ${String(option)} (backlog:triage --adopt)`
	const action = done === '' ? '' : ` · parent action done: ${done}`

	return `${issue_cite.plain_for('github', issue)}: ${adopted} — ${reason}${action}`
}

async function is_requeued(issue: string): Promise<boolean> {
	const result = await josh_command.josh_run(['run:add', issue, '--retry'], true)

	return result.code === SUCCESS_EXIT_CODE
}

// The decision, the park, then the requeue — the problem naming what was written before it, or
// `undefined`.
async function write(
	request: AdoptRequest,
	epic: number,
	directory: string,
): Promise<string | undefined> {
	const { issue } = request
	const decided = await epic_decide.decide({
		epic_number: epic,
		children: [Number(issue)],
		decision: decision_of(request),
	})

	if (decided !== SUCCESS_EXIT_CODE) return DECIDE_FAILED

	run_park.clear(issue, directory)

	if (await is_requeued(issue)) return undefined

	return `${REQUEUE_FAILED_HEAD} \`run:add ${issue} --retry\` failed; re-run this command`
}

async function adopt(request: AdoptRequest, directory: string): Promise<number> {
	const { issue, option } = request
	const read = await read_of(request)

	if ('problem' in read) return refused(issue, read.problem)
	const approval = await approval_of(request, read.park)
	const write_problem = await write(request, read.epic, directory)

	if (write_problem !== undefined) return refused(issue, write_problem)
	const epic = session_cite.issue(String(read.epic))
	const approved = approval === undefined ? '' : ` · size approval ${approval}`

	console.info(
		`adopt ${session_cite.issue(issue)} — option ${String(option)}${approved} · decided in ${epic} · park cleared · requeued`,
	)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>, directory: string): Promise<number> {
	const values = cli_flags.values_of(argv, OPTIONS)
	const request = values === undefined ? undefined : request_of(values)

	if (request !== undefined) return await adopt(request, directory)
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

const backlog_triage_adopt = { FLAG: '--adopt', run }

export { backlog_triage_adopt }
