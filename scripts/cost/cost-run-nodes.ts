import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'

// Classifying a run's transcripts into role-tagged tree nodes (joshuafolkken/kit#1937).
//
// **No transcript line records a session's role** — `JOSH_LANE_CHILD` and its siblings are live
// environment variables that never reach disk — so the role is read from where the file sat and the
// order it ran in: a delegated unit is a subagent, an own file under a lane's project slug is a lane
// child, and an own file under the main checkout's slug is the parent that launched the run or a
// wake/resume of it. Depth and the immediate parent come from the qualified id `cost-transcript.ts`
// already builds; a nested subagent therefore reads its own depth rather than the parent's alone.

type RunRole = 'parent' | 'wake' | 'lane' | 'subagent'

const PARENT_DEPTH = 0
const LANE_DEPTH = 1
const FIRST = 0

// What a node needs about a session that the file alone does not carry: its priced records, the
// preamble its first request opened with, and whether the transcript could be read at all. Injected
// rather than read here so the classification is a pure function a test drives with fabricated files.
interface SessionFacts {
	records: ReadonlyArray<UsageRecord>
	baseline_tokens: number
	is_readable: boolean
}

// The two things only the caller knows: how to fetch a session's facts by id, and whether a given
// file is a lane child's (and if so, for which issue). Both are fed from the filesystem by `load`,
// and from literals by a unit test.
interface NodeContext {
	facts: (session_id: string) => SessionFacts
	lane_issue: (file: SessionFile) => number | undefined
}

interface RunNode {
	session_id: string
	role: RunRole
	// The issue the session worked on, read from its branch or lane slug; `undefined` for an
	// orchestrator whose branch names none.
	issue: number | undefined
	// The session this one was launched under: the root parent for a lane child or a wake, the
	// spawning session for a subagent (at any depth), `undefined` for the root parent itself.
	parent_id: string | undefined
	// Distance from the root parent: `0` for the parent and its wakes, `1` for a lane child or a
	// subagent of the parent, `2` for a subagent of a lane child or a nested subagent, and so on.
	depth: number
	modified_ms: number
	records: ReadonlyArray<UsageRecord>
	baseline_tokens: number
	is_readable: boolean
}

const LEADING_ISSUE = /^(\d+)-/u

// The issue a branch names, or `undefined` when it does not lead with one — `1937-lane` and
// `1937-add-a-scope` both read 1937, while `main` reads nothing.
function issue_from_branch(branch: string): number | undefined {
	const match = LEADING_ISSUE.exec(branch)

	return match?.[1] === undefined ? undefined : Number(match[1])
}

function branch_issue(records: ReadonlyArray<UsageRecord>): number | undefined {
	for (const record of records) {
		const issue = issue_from_branch(record.branch)

		if (issue !== undefined) return issue
	}

	return undefined
}

// A session's own start, so the earliest main-checkout session can be told from the wakes that
// resumed it. One with no readable timestamp sorts last, the honest place for one whose order is
// unknown.
function started_ms(records: ReadonlyArray<UsageRecord>): number {
	const stamps = records.map((record) => record.at_ms).filter((ms) => ms !== undefined)

	return stamps.length === FIRST ? Infinity : Math.min(...stamps)
}

interface Split {
	mains: Array<SessionFile>
	lanes: Array<SessionFile>
	subs: Array<SessionFile>
}

function bucket_of(file: SessionFile, context: NodeContext): keyof Split {
	if (file.is_delegated) return 'subs'
	if (context.lane_issue(file) === undefined) return 'mains'

	return 'lanes'
}

function split_files(files: ReadonlyArray<SessionFile>, context: NodeContext): Split {
	const split: Split = { mains: [], lanes: [], subs: [] }

	for (const file of files) split[bucket_of(file, context)].push(file)

	return split
}

// The main-checkout own sessions oldest-first, so the head is the parent and the tail are its wakes.
function order_mains(mains: ReadonlyArray<SessionFile>, context: NodeContext): Array<SessionFile> {
	return [...mains].toSorted(
		(left, right) =>
			started_ms(context.facts(left.session_id).records) -
			started_ms(context.facts(right.session_id).records),
	)
}

function to_node(
	file: SessionFile,
	role: RunRole,
	head: Pick<RunNode, 'issue' | 'parent_id' | 'depth'>,
	facts: SessionFacts,
): RunNode {
	return {
		session_id: file.session_id,
		role,
		modified_ms: file.modified_ms,
		records: facts.records,
		baseline_tokens: facts.baseline_tokens,
		is_readable: facts.is_readable,
		...head,
	}
}

function main_node(
	file: SessionFile,
	is_parent: boolean,
	root_id: string,
	context: NodeContext,
): RunNode {
	return to_node(
		file,
		is_parent ? 'parent' : 'wake',
		{ issue: undefined, parent_id: is_parent ? undefined : root_id, depth: PARENT_DEPTH },
		context.facts(file.session_id),
	)
}

function lane_node(file: SessionFile, root_id: string | undefined, context: NodeContext): RunNode {
	const facts = context.facts(file.session_id)

	return to_node(
		file,
		'lane',
		{
			issue: context.lane_issue(file) ?? branch_issue(facts.records),
			parent_id: root_id,
			depth: LANE_DEPTH,
		},
		facts,
	)
}

// A subagent's depth counts from the root parent, so a unit under a lane child sits one below the
// lane's own depth. The immediate parent is the qualified id's owner before its last separator, which
// is the spawning session at any nesting.
function sub_node(
	file: SessionFile,
	lane_roots: ReadonlySet<string>,
	context: NodeContext,
): RunNode {
	const facts = context.facts(file.session_id)
	const base = lane_roots.has(cost_transcript.owning_session_id(file)) ? LANE_DEPTH : PARENT_DEPTH

	return to_node(
		file,
		'subagent',
		{
			issue: branch_issue(facts.records),
			parent_id: cost_transcript.parent_session_id(file),
			depth: base + file.depth,
		},
		facts,
	)
}

// One run's files classified. The mains are ordered so the earliest is the parent and the rest are
// wakes; lanes and subagents hang off it.
function build_nodes(files: ReadonlyArray<SessionFile>, context: NodeContext): Array<RunNode> {
	const split = split_files(files, context)
	const mains = order_mains(split.mains, context)
	const root_id = mains[FIRST]?.session_id
	const lane_roots = new Set(split.lanes.map((file) => file.session_id))

	return [
		...mains.map((file, index) =>
			main_node(file, index === FIRST, root_id ?? file.session_id, context),
		),
		...split.lanes.map((file) => lane_node(file, root_id, context)),
		...split.subs.map((file) => sub_node(file, lane_roots, context)),
	]
}

const cost_run_nodes = {
	issue_from_branch,
	branch_issue,
	started_ms,
	split_files,
	order_mains,
	build_nodes,
}

export type { NodeContext, RunNode, RunRole, SessionFacts }
export { cost_run_nodes }
