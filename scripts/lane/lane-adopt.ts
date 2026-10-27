import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import {
	git_gh_pr_read,
	read_pull_or_listed,
	read_pull as read_rest_pull,
} from '#scripts/gh/git-gh-pr-read'
import { git_gh_pr_rest } from '#scripts/gh/git-gh-pr-rest'
import { git_command } from '#scripts/git/git-command'
import { issue_state, type IssueState } from '#scripts/issue/issue-state'
import { session_cite } from '#scripts/issue/session-cite'
import { PROCESS_ALIVE, PROCESS_NONE, type ProcessTrace } from '#scripts/run/run-liveness'
import { lane_await } from './lane-await'
import type { LaneInfo } from './lane-registry'
import { lane_spent } from './lane-spent'
import {
	lane_state,
	type LaneChange,
	type LaneRecords,
	type LaneState,
	type RecordOutcome,
} from './lane-state'

// `josh lane:adopt` (joshuafolkken/kit#4744): give a lane whose state record was lost — a restart, a
// usage limit, an interrupted run — a record again, from what can be read off it, without touching its
// branch, its work tree or its pull request.
//
// **Nothing is guessed.** A lane is written `open` — opened, no child working in it — only when its
// process probe answers that no child is there and its work tree status, its unpushed commits, its pull
// request and its issue all read; any one unread leaves it unknown, counted in use as before
// (`backlog-occupied.ts`). `open` rather than `paused`: nobody suspended it, and a paused lane is one
// `run:liveness` says not to recover. The next launch moves it to `running` (`lane-state.ts`), and
// the next `backlogrun` takes the lane back while its issue still carries `in-progress`
// (`backlog-drive-carried.ts`).

const ADOPT_COMMAND = 'lane:adopt'
const ISSUE_FIELDS = 'state,labels'
const SEPARATOR = ' · '

// The branch's pull request — the open one, else the newest (`git_gh_pr_rest.select_pull`) — with its
// gh state, since a reopened lane's branch can still carry the merged one.
interface Pull {
	number: number
	state: string
}

// A pull request read: the branch's pull request, or none.
interface PullRead {
	pull: Pull | undefined
}

interface LaneFacts {
	branch: string
	is_dirty: boolean
	unpushed: number
	pull: Pull | undefined
	issue: IssueState
}

// Each read answers `undefined` when it could not be made.
interface AdoptPorts {
	process_trace: (issue: string) => ProcessTrace
	tree_status: (directory: string) => Promise<string | undefined>
	unpushed_commits: (branch: string) => Promise<number | undefined>
	pull_request: (branch: string) => Promise<PullRead | undefined>
	issue: (issue: string) => Promise<IssueState | undefined>
	record: (change: LaneChange) => Promise<RecordOutcome>
}

type Adoption =
	| { kind: 'adopted'; facts: LaneFacts }
	| { kind: 'kept'; state: LaneState }
	| { kind: 'left'; reason: string }

async function read_tree_status(directory: string): Promise<string | undefined> {
	try {
		return await git_command.status(directory)
	} catch {
		return undefined
	}
}

async function read_pull(branch: string): Promise<Pull | undefined> {
	const number = await git_gh_pr_read.pr_get_number(branch)

	if (number === undefined) return undefined

	// The listing row carries `state` and `merged_at` too, so it stands in for a detail GitHub refuses
	// as too many files changed.
	const pull = await read_pull_or_listed(branch, number, read_rest_pull)
	const state = git_gh_pr_rest.to_pr_state(pull)

	return state === undefined ? undefined : { number, state }
}

// `undefined` when anything could not be read, including a pull request that exists but whose number
// or state did not resolve.
async function read_pull_request(branch: string): Promise<PullRead | undefined> {
	try {
		if (!(await git_gh_pr_read.pr_exists(branch))) return { pull: undefined }

		const pull = await read_pull(branch)

		return pull === undefined ? undefined : { pull }
	} catch {
		return undefined
	}
}

async function read_issue(issue: string): Promise<IssueState | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue, ISSUE_FIELDS)

	return json === undefined ? undefined : issue_state.parse_issue_state(json)
}

async function record_open(change: LaneChange): Promise<RecordOutcome> {
	return await lane_state.record_adopted(change)
}

const LIVE_PORTS: AdoptPorts = {
	process_trace: lane_await.process_trace_default,
	tree_status: read_tree_status,
	unpushed_commits: lane_spent.read_unpushed_commits,
	pull_request: read_pull_request,
	issue: read_issue,
	record: record_open,
}

function left(reason: string): Adoption {
	return { kind: 'left', reason }
}

function process_reason(lane: LaneInfo, ports: AdoptPorts): string | undefined {
	if (lane.is_stranded) return 'its work tree is gone'

	const trace = ports.process_trace(lane.issue)

	if (trace === PROCESS_ALIVE) return 'a child is working in it'

	return trace === PROCESS_NONE ? undefined : 'its process probe did not answer'
}

// What each fact is called where it could not be read, in the order `facts_of` reads them.
const FACT_NAMES = ['work tree status', 'unpushed commits', 'pull request', 'issue'] as const

function unread_names(reads: ReadonlyArray<unknown>): string {
	return FACT_NAMES.filter((_name, index) => reads[index] === undefined).join(', ')
}

async function facts_of(lane: LaneInfo, ports: AdoptPorts): Promise<LaneFacts | string> {
	const reads = await Promise.all([
		ports.tree_status(lane.directory),
		ports.unpushed_commits(lane.branch),
		ports.pull_request(lane.branch),
		ports.issue(lane.issue),
	])
	const [status, unpushed, pull, issue] = reads

	if (status === undefined || unpushed === undefined || pull === undefined || issue === undefined) {
		return `could not read its ${unread_names(reads)}`
	}

	return { branch: lane.branch, is_dirty: status.trim() !== '', unpushed, pull: pull.pull, issue }
}

async function written(issue: string, facts: LaneFacts, ports: AdoptPorts): Promise<Adoption> {
	const outcome = await ports.record({ issue, state: 'open', command: ADOPT_COMMAND })

	return outcome.kind === 'written' ? { kind: 'adopted', facts } : left(outcome.reason)
}

/** Write an `open` record for `lane` when it has none and every fact about it reads. */
async function adopt(
	lane: LaneInfo,
	records: LaneRecords,
	ports: AdoptPorts = LIVE_PORTS,
): Promise<Adoption> {
	const recorded = records.get(lane.issue)

	if (recorded !== undefined) return { kind: 'kept', state: recorded.state }

	const blocked = process_reason(lane, ports)

	if (blocked !== undefined) return left(blocked)

	const facts = await facts_of(lane, ports)

	return typeof facts === 'string' ? left(facts) : await written(lane.issue, facts, ports)
}

/** `branch 4744-lane · uncommitted changes · 2 unpushed commit(s) · PR [#4801](…) OPEN · issue OPEN (in-progress)` */
function facts_text(facts: LaneFacts): string {
	const labels = facts.issue.labels.length > 0 ? ` (${facts.issue.labels.join(', ')})` : ''

	return [
		`branch ${facts.branch}`,
		facts.is_dirty ? 'uncommitted changes' : 'clean tree',
		`${String(facts.unpushed)} unpushed commit(s)`,
		facts.pull === undefined
			? 'no PR'
			: `PR ${session_cite.issue(facts.pull.number)} ${facts.pull.state}`,
		`issue ${facts.issue.state}${labels}`,
	].join(SEPARATOR)
}

const lane_adopt = { ADOPT_COMMAND, adopt, facts_text, read_pull_request }

export { lane_adopt }
export type { AdoptPorts, Adoption, LaneFacts }
