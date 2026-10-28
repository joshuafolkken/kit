import path from 'node:path'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_paths } from '#scripts/lane/lane-paths'
import { cost_run_cut } from './cost-run-cut'
import { cost_run_nodes, type NodeContext, type RunNode } from './cost-run-nodes'

// Grouping a transcript store into runs and selecting one.
//
// A run is rooted at a main-checkout parent session; the wakes that resumed it cluster with it by
// time, and the lane children and subagents that ran inside its window hang off it. The no-argument
// default is the *last run* — the cluster whose activity is newest — rather than the newest single
// transcript, which under a batch is one lane child and answers for a twelfth of the run.

// A main-checkout session that starts after the store sat quiet for longer than this opens a new run.
// **The quiet is measured from the last write any session made before it, not from the previous
// main's start**: a run idles for the whole idle wait once nothing can proceed, then a child runs for as long as it
// takes before the wake that judges it, so two mains of one run start any distance apart — but no
// session writes only while the run waits, and that wait is bounded. One poll is added because the
// pick the last poll makes starts its child after the wait's end. Two runs closer than this merge,
// deliberately: merging is a visible over-count a reader can see, while splitting one hides half of it.
const RUN_GAP_MS = backlog_budget.DEFAULT_IDLE_MS + backlog_budget.OFFER_INTERVAL_MS
const FIRST = 0
const NONE = -1

interface RunTree {
	// The classified sessions of the selected run.
	nodes: ReadonlyArray<RunNode>
	// The selected run's transcript files, one per node, for a reader that needs more of a session than
	// its priced records — the retrospective's guard tally.
	files: ReadonlyArray<SessionFile>
	// How many runs the store held, so a reader knows the selected one was chosen from several.
	run_count: number
	// Transcripts in the store that the selected run did not claim — reported as a count, never folded
	// into the run's own figures.
	unattributed_count: number
}

interface Cluster {
	root_id: string
	first_start: number
	files: Array<SessionFile>
}

// The top-level sessions whose writes say the store was active: the mains to group, and the lane
// children that ran between them.
interface Activity {
	mains: ReadonlyArray<SessionFile>
	sessions: ReadonlyArray<SessionFile>
}

function cluster_end(cluster: Cluster): number {
	return Math.max(...cluster.files.map((file) => file.modified_ms))
}

function start_of(file: SessionFile, context: NodeContext): number {
	return cost_run_nodes.started_ms(context.facts(file.session_id).records)
}

// Every write of the top-level sessions, oldest first. A session is written for as long as it is
// continued, so its last write says nothing about a moment before it: a conversation resumed the next
// morning, or a lane still running, was last written after every main that started in between.
function write_stamps(activity: Activity, context: NodeContext): Array<number> {
	const stamps = activity.sessions.flatMap((file) =>
		context.facts(file.session_id).records.map((record) => record.at_ms),
	)

	return stamps.filter((ms) => ms !== undefined).toSorted((left, right) => left - right)
}

// The last write before each main started — `-Infinity` when nothing precedes it. A session's own
// writes begin at its start, so none of them is counted against it. `mains` are oldest-first, so one
// pass over the stamps serves them all.
function writes_before(activity: Activity, context: NodeContext): Map<string, number> {
	const stamps = write_stamps(activity, context)
	const before = new Map<string, number>()
	let cursor = FIRST

	for (const main of activity.mains) {
		const start = start_of(main, context)

		while ((stamps[cursor] ?? Infinity) < start) cursor += 1
		before.set(main.session_id, stamps[cursor - 1] ?? -Infinity)
	}

	return before
}

// Whether the store was still active within the run window before `main` started, so the main extends
// the cluster still open rather than opening a new run.
function fits(last: Cluster | undefined, quiet_ms: number): last is Cluster {
	return last !== undefined && quiet_ms <= RUN_GAP_MS
}

function open_cluster(file: SessionFile, start: number): Cluster {
	return { root_id: file.session_id, first_start: start, files: [file] }
}

// The main-checkout sessions grouped into runs by how long the store sat quiet before each.
// `order_mains` has already put them oldest-first, so a new cluster opens whenever that quiet exceeds
// the run window.
function cluster_mains(activity: Activity, context: NodeContext): Array<Cluster> {
	const clusters: Array<Cluster> = []
	const before = writes_before(activity, context)

	for (const file of activity.mains) {
		const start = start_of(file, context)
		const last = clusters.at(NONE)

		if (fits(last, start - (before.get(file.session_id) ?? -Infinity))) last.files.push(file)
		else clusters.push(open_cluster(file, start))
	}

	return clusters
}

// The cluster a session that started at `start` belongs to: the latest run already open when it ran.
// A session that predates every run falls to the earliest, so nothing is dropped.
function cluster_for_start(clusters: ReadonlyArray<Cluster>, start: number): Cluster | undefined {
	return clusters.findLast((cluster) => cluster.first_start <= start) ?? clusters[FIRST]
}

function attach_lanes(
	clusters: ReadonlyArray<Cluster>,
	lanes: ReadonlyArray<SessionFile>,
	context: NodeContext,
): void {
	for (const file of lanes) {
		const start = cost_run_nodes.started_ms(context.facts(file.session_id).records)

		cluster_for_start(clusters, start)?.files.push(file)
	}
}

// A subagent joins the run of the root session it was spawned under; an orphan whose root is nowhere
// falls to the cluster its own start places it in, the same rule a lane uses.
function index_by_session(clusters: ReadonlyArray<Cluster>): Map<string, Cluster> {
	const by_session = new Map<string, Cluster>()

	for (const cluster of clusters) {
		for (const file of cluster.files) by_session.set(file.session_id, cluster)
	}

	return by_session
}

function attach_subs(
	clusters: ReadonlyArray<Cluster>,
	subs: ReadonlyArray<SessionFile>,
	context: NodeContext,
): void {
	const by_session = index_by_session(clusters)

	for (const file of subs) {
		const owner = by_session.get(cost_transcript.owning_session_id(file))
		const start = cost_run_nodes.started_ms(context.facts(file.session_id).records)

		;(owner ?? cluster_for_start(clusters, start))?.files.push(file)
	}
}

// A run rooted at the parent session, unless there is none — a lone `fullrun` launched in a lane
// checkout has only lane-slug sessions, and those are then the roots rather than nothing at all.
function build_clusters(files: ReadonlyArray<SessionFile>, context: NodeContext): Array<Cluster> {
	const split = cost_run_nodes.split_files(files, context)
	const has_mains = split.mains.length > FIRST
	const roots = has_mains ? split.mains : split.lanes
	const mains = cost_run_nodes.order_mains(roots, context)
	const clusters = cluster_mains({ mains, sessions: [...split.mains, ...split.lanes] }, context)

	if (has_mains) attach_lanes(clusters, split.lanes, context)
	attach_subs(clusters, split.subs, context)

	return clusters
}

function last_cluster(clusters: ReadonlyArray<Cluster>): Cluster | undefined {
	return [...clusters].toSorted((left, right) => cluster_end(right) - cluster_end(left))[FIRST]
}

function named_cluster(clusters: ReadonlyArray<Cluster>, run_id: string): Cluster | undefined {
	return clusters.find(
		(cluster) =>
			cluster.root_id === run_id || cluster.files.some((file) => file.session_id === run_id),
	)
}

// The run to report on: the one named by `--run`, or the last run when none was named. `undefined`
// means the store held no run at all.
function select(clusters: ReadonlyArray<Cluster>, run_id: string | undefined): Cluster | undefined {
	return run_id === undefined ? last_cluster(clusters) : named_cluster(clusters, run_id)
}

function to_tree(
	files: ReadonlyArray<SessionFile>,
	chosen: Cluster,
	context: NodeContext,
	run_count: number,
): RunTree {
	const nodes = cost_run_nodes.build_nodes(chosen.files, context)

	return {
		nodes,
		files: chosen.files,
		run_count,
		unattributed_count: files.length - chosen.files.length,
	}
}

// The whole store grouped into runs, with one selected. Pure over its inputs so a test drives it with
// fabricated files and a literal context; `load` is what feeds it the real filesystem.
function build_tree(
	files: ReadonlyArray<SessionFile>,
	context: NodeContext,
	run_id: string | undefined,
): RunTree | undefined {
	const clusters = build_clusters(files, context)
	const chosen = select(clusters, run_id)

	if (chosen === undefined) return undefined

	return to_tree(files, chosen, context, clusters.length)
}

function lane_prefix(cwd: string): string {
	return `${cost_transcript.project_slug(lane_paths.lane_root(cwd))}-`
}

function slug_of(file_path: string, projects_root: string): string {
	return path.relative(projects_root, file_path).split(path.sep)[FIRST] ?? ''
}

// Whether a file sits under a lane's project slug, and the issue that lane is for. The slug is
// `<lane-root-slug>-<digits>`, so a coincidental sibling that is not all digits after the prefix is
// not a lane — the same test `cost-transcript.ts` applies when it lists the lane directories.
function lane_issue_of(
	file: SessionFile,
	projects_root: string,
	prefix: string,
): number | undefined {
	const slug = slug_of(file.path, projects_root)

	if (!slug.startsWith(prefix)) return undefined

	const rest = slug.slice(prefix.length)

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(rest) ? Number(rest) : undefined
}

function to_context(
	files: ReadonlyArray<SessionFile>,
	cwd: string,
	projects_root: string,
): NodeContext {
	const prefix = lane_prefix(cwd)
	const usage = new Map(files.map((file) => [file.session_id, cost_transcript.read_session(file)]))

	return {
		facts: (id) => usage.get(id) ?? { records: [], baseline_tokens: 0, is_readable: false },
		lane_issue: (file) => lane_issue_of(file, projects_root, prefix),
		lane_marks: (file) => cost_run_cut.lane_marks(file),
	}
}

// The run tree read from the filesystem the command ran in. Reports on the last run when `run_id` is
// omitted. `undefined` means no transcript was found at all, which the caller reports in words.
function load(cwd: string, run_id: string | undefined): RunTree | undefined {
	const directories = cost_transcript.transcript_directories(cwd)
	const files = cost_transcript.list_sessions_across(directories)

	if (files.length === FIRST) return undefined

	const projects_root = path.dirname(directories[FIRST] ?? '')

	return build_tree(files, to_context(files, cwd, projects_root), run_id)
}

const cost_run_tree = {
	build_tree,
	lane_issue_of,
	load,
}

export type { RunTree }
export { cost_run_tree }
