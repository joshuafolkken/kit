import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { issue_cite } from '#scripts/issue/issue-cite'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_overrun, type OverrunNote } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_text, type Report } from './lane-breakdown-text'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_overrun_prompt } from './lane-overrun-prompt'
import { lane_tail_stats } from './lane-tail-stats'

// A merged lane over the overrun threshold of net time is investigated for its causes
// (joshuafolkken/kit#4751). `run:merge` asks at each merge: a lane at or under the threshold — its long
// total spent waiting on a person or an outage included — stops here, before any record of it is read.
// An overrun launches a detached worker session that reads the lane's records and files each unfiled
// cause through `issue:file` — the causes one fix place shares as one issue, or folded into an open
// issue touching the same files (joshuafolkken/kit#4858) — so the next lane starts without waiting on
// it. The session carries the lane's child mark, which makes `issue:file` count its filings against the
// lane (`issue-file-cap.ts`), and `--found-during` names the same origin; its overrun mark records the
// filings as the investigation's, not the child's (joshuafolkken/kit#4880). The launch and the session's result both go on the run's
// event stream as notes.

const { EVENT_KIND } = run_event_stream
const LOG_PREFIX = 'josh-lane-overrun-'
const LOG_SUFFIX = '.log'
const NO_LEDGER = 'no ledger'

// A lane's net minutes and their breakdown by stage, or why there are none (joshuafolkken/kit#4818).
// `is_commented` says an earlier pass of the lane commented the breakdown on its Issue already.
type LaneNet =
	| { kind: 'minutes'; minutes: number; breakdown: Breakdown; is_commented: boolean }
	| { kind: 'missing'; reason: string }

// A launch that failed is retried once, at the next `run:merge` (joshuafolkken/kit#4930).
const MAX_LAUNCH_FAILURES = 2

function overrun_notes(events: ReadonlyArray<RunEvent>): ReadonlyArray<OverrunNote> {
	return events.flatMap((event) =>
		event.kind === EVENT_KIND.NOTE ? (run_event_overrun.parse(event.text) ?? []) : [],
	)
}

// A pass that threw before it noted anything leaves a failure with no minutes.
function is_thrown(note: OverrunNote): boolean {
	return note.kind === 'failed' && note.minutes === undefined
}

// A start note that launched no session.
function is_launch_failure(note: OverrunNote): boolean {
	return note.kind === 'failed' && note.minutes !== undefined
}

function is_final(note: OverrunNote): boolean {
	return !is_thrown(note) && !is_launch_failure(note)
}

// A merge `run:merge` collects again — a driver retry, a parent's hand run — finds its lane's note on
// the stream and launches no second session to file the same causes. A pass that threw before it
// noted anything leaves only its failure, which the retry answers; a launch that failed is answered
// once more.
function is_noted(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	const notes = overrun_notes(events).filter((note) => note.issue === issue)
	const failures = notes.filter((note) => is_launch_failure(note)).length

	return failures >= MAX_LAUNCH_FAILURES || notes.some((note) => is_final(note))
}

// The earlier lanes whose latest note is a launch failure not yet retried; a retry that threw leaves
// its own note last, so it is not swept up again at every merge after.
function retried_lanes(events: ReadonlyArray<RunEvent>, issue: number): ReadonlyArray<number> {
	const latest = new Map(overrun_notes(events).map((note) => [note.issue, note]))

	latest.delete(issue)

	return [...latest.values()]
		.filter((note) => is_launch_failure(note) && !is_noted(events, note.issue))
		.map((note) => note.issue)
}

// A pass that noted the lane before launched nothing it recorded, but it may have commented.
function is_commented(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	return overrun_notes(events).some((note) => note.issue === issue)
}

function net_in(path: string, events: ReadonlyArray<RunEvent>, issue: number): LaneNet {
	const entries = lane_ledger.read_entries(path)
	const minutes = lane_net_time.net_minutes(entries, events, issue)
	const breakdown = lane_breakdown.of(entries, events, issue)

	if (minutes === undefined || breakdown === undefined) {
		return { kind: 'missing', reason: lane_net_time.missing_reason(entries, issue) }
	}

	return { kind: 'minutes', minutes, breakdown, is_commented: is_commented(events, issue) }
}

// The net time of a lane not yet noted, or `undefined` when its note is on the stream already.
async function net_of(issue: number): Promise<LaneNet | undefined> {
	const events = await run_event_stream_emit.all_events()

	if (is_noted(events, issue)) return undefined

	const path = await lane_ledger.target()

	return path === undefined ? { kind: 'missing', reason: NO_LEDGER } : net_in(path, events, issue)
}

// What the session reads, and the four facts it traces each cause to.
function reading(issue: number, cite: string, minutes: number): string {
	const directories =
		lane_breakdown_implement.transcript_directories(issue).join(', ') || 'none found'

	return [
		`Investigate why lane ${cite} took ${String(minutes)} minutes of net time (dispatch to merge, less`,
		'its waits on a person and on outages). Leave this checkout as it is: write any file, an issue body',
		'included, under the system temp directory, and never stage, commit or push.',
		`Read the lane's transcripts (${directories}), its ship log (\`pnpm josh ship --log ${String(issue)}\`)`,
		'and the run events (`pnpm josh run:event --from 0`), and find the causes that spent time other than',
		'waiting. Trace each cause to what can fix it: the span it spent, the signal that led to the wrong call',
		'or the wait (which command printed what), the `file:line` of the code or document that decided it, and',
		'where to fix it.',
	].join(' ')
}

// One line: `detached_launch` lets a prompt break lines, but a single line keeps the log header whole.
// The breakdown leads, so the search starts from the longest stage (joshuafolkken/kit#4995).
function prompt(issue: number, minutes: number, report: Report): string {
	const reads = reading(issue, issue_cite.plain(issue), minutes)
	const stages = lane_breakdown_text.line(report)

	return `${stages} ${reads} ${lane_overrun_prompt.handling(issue, minutes)}`
}

function note_failure(issue: number): (note: string) => void {
	return (note) => {
		void run_event_stream_emit.emit(EVENT_KIND.NOTE, run_event_overrun.failed_text(issue, note))
	}
}

// A detached investigation session: its prompt, its `env` — the lane marks an overrun's filings count
// against that lane by, none for the baseline's — the prefix of its log's name, and the note a failed
// launch leaves.
interface Investigation {
	env: Readonly<Record<string, string>>
	prompt: string
	log_prefix: string
	on_failure: (note: string) => void
}

// What became of the launch, in the words the launch note carries — the overrun's and the baseline
// investigation's (`lane-baseline.ts`) alike.
function launch(investigation: Investigation): string {
	const cwd = process.cwd()
	const built = agent_argv.resolve_in(investigation.prompt, agent_role_profile.WORKER, cwd)

	if (built.kind === 'rejected') return `not investigated: ${built.note}`

	const request = {
		argv: built.argv,
		cwd,
		env: investigation.env,
		log_path: stamp_file.stamp_path(investigation.log_prefix, PROJECT_ROOT, LOG_SUFFIX),
		profile: built.profile,
	}
	const result = detached_launch.launch(request, investigation.on_failure)

	return result.kind === 'launched'
		? run_event_overrun.investigating(result.pid, process_identity.read_start(result.pid))
		: `not investigated: ${result.note}`
}

function launched(issue: number, minutes: number, report: Report): string {
	return launch({
		env: lane_child_marker.overrun_env_for(String(issue)),
		prompt: prompt(issue, minutes, report),
		log_prefix: `${LOG_PREFIX}${String(issue)}-`,
		on_failure: note_failure(issue),
	})
}

type OverranNet = Extract<LaneNet, { kind: 'minutes' }>

// The breakdown goes on the lane's Issue before the session starts, once across the lane's passes; a
// refused comment costs the comment, not the investigation.
async function overran_text(issue: number, net: OverranNet): Promise<string> {
	const report = lane_breakdown_text.report_of(issue, net.breakdown)
	const comment = lane_breakdown_text.comment(issue, net.minutes, report)

	if (!net.is_commented) await git_gh_issue_write.issue_try_comment(String(issue), comment)

	const outcome = launched(issue, net.minutes, report)
	const longest = lane_breakdown.longest_of(net.breakdown)

	return run_event_overrun.started_text(issue, net.minutes, outcome, longest)
}

// The note every merged lane leaves: its net minutes at or under the threshold, why it has none, or the
// launch of its overrun's investigation.
async function note_text(issue: number, net: LaneNet): Promise<string> {
	if (net.kind === 'missing') return run_event_overrun.skipped_text(issue, net.reason)
	// The threshold sets no priority: each filing is ranked by its causes' reducible minutes
	// (joshuafolkken/kit#4928). `lane:stats` counts the lanes over it on dispatch-to-merge time, not
	// on this net time.
	const is_over = lane_tail_stats.is_overrun(net.minutes)

	if (!is_over) return run_event_overrun.within_text(issue, net.minutes)

	return await overran_text(issue, net)
}

async function investigate_lane(issue: number): Promise<void> {
	const net = await net_of(issue)

	if (net === undefined) return

	await run_event_stream_emit.emit(EVENT_KIND.NOTE, await note_text(issue, net))
}

// Never fails the merge it follows: an error is a note on the stream, not a refused merge.
async function guarded(issue: number, pass: (issue: number) => Promise<void>): Promise<void> {
	try {
		await pass(issue)
	} catch (error) {
		note_failure(issue)(detached_launch.note_of(error))
	}
}

// The merged lane, then each earlier lane whose launch failed once.
async function investigate_with_retries(issue: number): Promise<void> {
	await investigate_lane(issue)
	const retried = retried_lanes(await run_event_stream_emit.all_events(), issue)

	for (const lane of retried) {
		// eslint-disable-next-line no-await-in-loop -- one pass at a time appends to the stream, as the merged lane's did
		await guarded(lane, investigate_lane)
	}
}

async function investigate(issue: number): Promise<void> {
	await guarded(issue, investigate_with_retries)
}

const lane_overrun = { investigate, launch }

export type { Investigation }
export { lane_overrun }
