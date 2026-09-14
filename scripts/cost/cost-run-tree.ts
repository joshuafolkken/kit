import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { lane_paths } from '#scripts/lane/lane-paths'
import { cost_run_nodes, type NodeContext, type RunNode } from './cost-run-nodes'

// Grouping a transcript store into runs and selecting one (joshuafolkken/kit#1937).
//
// A run is rooted at a main-checkout parent session; the wakes that resumed it cluster with it by
// time, and the lane children and subagents that ran inside its window hang off it. The no-argument
// default is the *last run* — the cluster whose activity is newest — rather than the newest single
// transcript, which under a batch is one lane child and answers for a twelfth of the run.

// Two main-checkout sessions that start more than this apart are different runs. A batch's wakes fire
// as its children finish, so they sit minutes apart; separate batches sit hours apart. The run-carry
// record expires at 8 hours, so a gap under that is deliberately generous — merging two runs is a
// visible over-count a reader can see, while splitting one hides half of it.
const MS_PER_HOUR = 3_600_000
const RUN_GAP_HOURS = 8
const RUN_GAP_MS = RUN_GAP_HOURS * MS_PER_HOUR
const FIRST = 0
const NONE = -1

interface RunTree {
	// The classified sessions of the selected run.
	nodes: ReadonlyArray<RunNode>
	// How many runs the store held, so a reader knows the selected one was chosen from several.
	run_count: number
	// Transcripts in the store that the selected run did not claim — reported as a count, never folded
	// into the run's own figures.
	unattributed_count: number
}

interface Cluster {
	root_id: string
	first_start: number
	last_start: number
	files: Array<SessionFile>
}

function cluster_end(cluster: Cluster): number {
	return Math.max(...cluster.files.map((file) => file.modified_ms))
}

// Whether `start` falls within the run window of the cluster still open, so the main extends it rather
// than opening a new run.
function fits(last: Cluster | undefined, start: number): last is Cluster {
	return last !== undefined && start - last.last_start <= RUN_GAP_MS
}

function open_cluster(file: SessionFile, start: number): Cluster {
	return { root_id: file.session_id, first_start: start, last_start: start, files: [file] }
}

// The main-checkout sessions grouped into runs by start-time proximity. `order_mains` has already put
// them oldest-first, so a new cluster opens whenever the gap since the previous main exceeds the run
// window.
function cluster_mains(mains: ReadonlyArray<SessionFile>, context: NodeContext): Array<Cluster> {
	const clusters: Array<Cluster> = []

	for (const file of mains) {
		const start = cost_run_nodes.started_ms(context.facts(file.session_id).records)
		const last = clusters.at(NONE)

		if (fits(last, start)) {
			last.files.push(file)
			last.last_start = start
		} else {
			clusters.push(open_cluster(file, start))
		}
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
	const clusters = cluster_mains(cost_run_nodes.order_mains(roots, context), context)

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

	return { nodes, run_count, unattributed_count: files.length - chosen.files.length }
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

const LANE_ISSUE = /^\d+$/u

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

	return LANE_ISSUE.test(rest) ? Number(rest) : undefined
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
	RUN_GAP_MS,
	build_tree,
	lane_issue_of,
	load,
	select,
	build_clusters,
}

export type { RunTree }
export { cost_run_tree }
