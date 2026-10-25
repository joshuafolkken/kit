import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { issue_cite } from '#scripts/issue/issue-cite'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_overrun_prompt } from './lane-overrun-prompt'

// A merged lane over the overrun threshold of net time is investigated for its causes
// (joshuafolkken/kit#4751). `run:merge` asks at each merge: a lane at or under the threshold — its long
// total spent waiting on a person or an outage included — stops here, before any record of it is read.
// An overrun launches a detached worker session that reads the lane's records and files each unfiled
// cause through `issue:file` — the causes one fix place shares as one issue, or folded into an open
// issue touching the same files (joshuafolkken/kit#4858) — so the next lane starts without waiting on
// it. The session carries the lane's child mark, which makes `issue:file` count its filings against the
// lane (`issue-file-cap.ts`), and `--found-during` names the same origin. The launch and the session's result both go on the run's
// event stream as notes.

const { EVENT_KIND } = run_event_stream
const LOG_PREFIX = 'josh-lane-overrun-'
const LOG_SUFFIX = '.log'
const NO_LEDGER = 'no ledger'
// The net minutes a lane may take before its causes are investigated. They set no priority: each filing
// is ranked by the reduction it states (joshuafolkken/kit#4870).
const OVERRUN_LANE_MINUTES = 40

// A lane's net minutes, or why there are none (joshuafolkken/kit#4818).
type LaneNet = { kind: 'minutes'; minutes: number } | { kind: 'missing'; reason: string }

function is_overrun(minutes: number): boolean {
	return minutes > OVERRUN_LANE_MINUTES
}

// A merge `run:merge` collects again — a driver retry, a parent's hand run — finds its lane's note on
// the stream and launches no second session to file the same causes. A pass that threw before it
// noted anything leaves only its failure, which the retry answers.
function is_noted(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	const notes = events.flatMap((event) =>
		event.kind === EVENT_KIND.NOTE ? (run_event_overrun.parse(event.text) ?? []) : [],
	)

	return notes.some(
		(note) => note.issue === issue && !(note.kind === 'failed' && note.minutes === undefined),
	)
}

function net_in(path: string, events: ReadonlyArray<RunEvent>, issue: number): LaneNet {
	const entries = lane_ledger.read_entries(path)
	const minutes = lane_net_time.net_minutes(entries, events, issue)

	if (minutes !== undefined) return { kind: 'minutes', minutes }

	return { kind: 'missing', reason: lane_net_time.missing_reason(entries, issue) }
}

// The net time of a lane not yet noted, or `undefined` when its note is on the stream already.
async function net_of(issue: number): Promise<LaneNet | undefined> {
	const events = await run_event_stream_emit.all_events()

	if (is_noted(events, issue)) return undefined

	const path = await lane_ledger.target()

	return path === undefined ? { kind: 'missing', reason: NO_LEDGER } : net_in(path, events, issue)
}

function transcript_directories(issue: number): ReadonlyArray<string> {
	const main_cwd = cost_transcript.session_cwd(process.cwd())
	const home = cost_transcript.home_directory()
	const suffix = `-${String(issue)}`

	return cost_transcript
		.lane_transcript_directories(main_cwd, home)
		.filter((directory) => directory.endsWith(suffix))
}

// What the session reads, and the four facts it traces each cause to.
function reading(issue: number, cite: string, minutes: number): string {
	const directories = transcript_directories(issue).join(', ') || 'none found'

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
function prompt(issue: number, minutes: number): string {
	const reads = reading(issue, issue_cite.plain(issue), minutes)

	return `${reads} ${lane_overrun_prompt.handling(issue, minutes)}`
}

function log_path(issue: number): string {
	return stamp_file.stamp_path(`${LOG_PREFIX}${String(issue)}-`, PROJECT_ROOT, LOG_SUFFIX)
}

function note_failure(issue: number): (note: string) => void {
	return (note) => {
		void run_event_stream_emit.emit(EVENT_KIND.NOTE, run_event_overrun.failed_text(issue, note))
	}
}

// What became of the launch, in the words the launch note carries.
function launched(issue: number, minutes: number): string {
	const cwd = process.cwd()
	const built = agent_argv.resolve_in(prompt(issue, minutes), agent_role_profile.WORKER, cwd)

	if (built.kind === 'rejected') return `not investigated: ${built.note}`

	const request = {
		argv: built.argv,
		cwd,
		env: lane_child_marker.env_for(String(issue)),
		log_path: log_path(issue),
		profile: built.profile,
	}
	const result = detached_launch.launch(request, note_failure(issue))

	return result.kind === 'launched'
		? run_event_overrun.investigating(result.pid, process_identity.read_start(result.pid))
		: `not investigated: ${result.note}`
}

// The note every merged lane leaves: its net minutes at or under the threshold, why it has none, or the
// launch of its overrun's investigation.
function note_text(issue: number, net: LaneNet): string {
	if (net.kind === 'missing') return run_event_overrun.skipped_text(issue, net.reason)
	if (!is_overrun(net.minutes)) return run_event_overrun.within_text(issue, net.minutes)

	return run_event_overrun.started_text(issue, net.minutes, launched(issue, net.minutes))
}

async function investigate_lane(issue: number): Promise<void> {
	const net = await net_of(issue)

	if (net === undefined) return

	await run_event_stream_emit.emit(EVENT_KIND.NOTE, note_text(issue, net))
}

// Never fails the merge it follows: an error is a note on the stream, not a refused merge.
async function investigate(issue: number): Promise<void> {
	try {
		await investigate_lane(issue)
	} catch (error) {
		note_failure(issue)(detached_launch.note_of(error))
	}
}

const lane_overrun = { investigate }

export { lane_overrun }
