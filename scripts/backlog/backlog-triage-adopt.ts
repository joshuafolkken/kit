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
import { backlog_triage_close } from './backlog-triage-close'
import { backlog_triage_filing } from './backlog-triage-filing'
import { backlog_triage_park } from './backlog-triage-park'
import { backlog_triage_park_loop } from './backlog-triage-park-loop'

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
// records the action. An option that files an Issue is adopted only with `--done` naming the open
// Issue filed, and the child is then blocked by it instead of requeued (joshuafolkken/kit#7771).
//
// **A closing option is the one parent action the adopt takes itself** (joshuafolkken/kit#7805): with
// no `--done` (unless it also files), the child is closed as not planned with the reason and its lane
// returned (`backlog-triage-close.ts`), neither requeued nor blocked. A re-park on the lane tree the
// last adopted option left unchanged is parked `run:stalled` instead (`backlog-triage-park-loop.ts`).

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
	is_filing: boolean
	is_close: boolean
}

interface AdoptRead {
	epic: number
	park: ParkFound
}

type WriteResult = { next: string } | { problem: string }

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
	const is_needed = run_park_body.done_needed(body, option)
	const is_given = done !== ''

	if (is_needed === is_given) return undefined

	return is_needed
		? `option ${String(option)} needs the parent's own action; take it, then re-run with --done "<what was done>" — nothing was written and the child stays parked`
		: `option ${String(option)} needs no parent action; re-run without --done — nothing was written`
}

function refused(issue: string, problem: string): number {
	console.error(`${session_cite.issue(issue)}: ${problem}`)

	return FAILURE_EXIT_CODE
}

// A filing option's `--done` names the open Issue it filed (`backlog-triage-filing.ts`).
async function filing_problem(
	request: AdoptRequest,
	is_filing: boolean,
): Promise<string | undefined> {
	if (!is_filing) return undefined

	return await backlog_triage_filing.problem_of(request.issue, request.done)
}

async function park_of(request: AdoptRequest): Promise<ParkFound | { problem: string }> {
	const park = await backlog_triage_park.read(request.issue)

	if ('problem' in park) return park
	const { body, comments } = park
	const is_filing = run_park_body.filing_action(body, request.option)
	const problem =
		run_park_body.adopt_problem(body, request.option) ??
		action_problem(body, request) ??
		(await filing_problem(request, is_filing))

	if (problem !== undefined) return { problem }

	const range = run_park_body.approval_range(body, request.option)

	return { comments, range, is_filing, is_close: run_park_body.close_action(body, request.option) }
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

async function requeue(issue: string): Promise<WriteResult> {
	const result = await josh_command.josh_run(['run:add', issue, '--retry'], true)

	if (result.code === SUCCESS_EXIT_CODE) return { next: 'requeued' }

	return {
		problem: `${REQUEUE_FAILED_HEAD} \`run:add ${issue} --retry\` failed; re-run this command`,
	}
}

// A filing option's child waits on the filed Issue instead of a requeue: `#M`'s merge resumes it.
async function block(request: AdoptRequest): Promise<WriteResult> {
	const { issue, done } = request
	const filed = session_cite.issue(String(backlog_triage_filing.filed_of(done)))

	try {
		const status = await backlog_triage_filing.block(issue, done)

		return { next: `blocked by ${filed} (${status}) · waits for its merge, not requeued` }
	} catch (error) {
		const message = error_text.message_of(error)

		return {
			problem: `${REQUEUE_FAILED_HEAD} blocking by ${filed} failed: ${message}; re-run this command`,
		}
	}
}

// A re-park on the tree the last adopted option left unchanged is held for a person, not requeued.
async function requeue_or_hold(request: AdoptRequest, park: ParkFound): Promise<WriteResult> {
	const { issue, option } = request
	const loop = backlog_triage_park_loop.loop_of(park.comments)

	if (loop === undefined) return await requeue(issue)

	return await backlog_triage_park_loop.hold(issue, option, loop)
}

// What follows the decision: the close, the block, or the requeue.
async function follow_up(request: AdoptRequest, park: ParkFound): Promise<WriteResult> {
	if (park.is_close) return await backlog_triage_close.close(request.issue, request.reason)

	return park.is_filing ? await block(request) : await requeue_or_hold(request, park)
}

// The decision, the park, then the follow-up — what the run did next, or the problem naming what was
// written before it.
async function write(
	request: AdoptRequest,
	read: AdoptRead,
	directory: string,
): Promise<WriteResult> {
	const { issue } = request
	const decided = await epic_decide.decide({
		epic_number: read.epic,
		children: [Number(issue)],
		decision: decision_of(request),
	})

	if (decided !== SUCCESS_EXIT_CODE) return { problem: DECIDE_FAILED }

	run_park.clear(issue, directory)

	return await follow_up(request, read.park)
}

async function adopt(request: AdoptRequest, directory: string): Promise<number> {
	const { issue, option } = request
	const read = await read_of(request)

	if ('problem' in read) return refused(issue, read.problem)
	const approval = await approval_of(request, read.park)
	const written = await write(request, read, directory)

	if ('problem' in written) return refused(issue, written.problem)
	const epic = session_cite.issue(String(read.epic))
	const approved = approval === undefined ? '' : ` · size approval ${approval}`

	console.info(
		`adopt ${session_cite.issue(issue)} — option ${String(option)}${approved} · decided in ${epic} · park cleared · ${written.next}`,
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
