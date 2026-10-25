import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_priority } from '#scripts/issue/issue-priority'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'

// A merged lane over the high-priority threshold of net time is investigated for its causes
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

// A lane's net minutes, or why there are none (joshuafolkken/kit#4818).
type LaneNet = { kind: 'minutes'; minutes: number } | { kind: 'missing'; reason: string }

function is_overrun(minutes: number): boolean {
	return minutes > issue_priority.HIGH_LANE_MINUTES
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

// Each lane pays a fixed review-to-merge cost, so causes one fix place shares are one issue. A fold
// skips `issue:file`, so it carries the causing-lane line and the priority floor `issue:file` would set.
function grouping(issue: number, lane_line: string, minutes: number): string {
	const label = issue_priority.lane_label(minutes)
	const labeling =
		label === undefined ? '' : `, and give it the \`${label}\` label unless it carries a higher one`

	return [
		'Causes whose fixes touch the same file or mechanism are one issue, an acceptance criterion per',
		'cause; causes fixed in different places are separate issues. Before filing one, look for an open',
		'issue that touches the same files (`pnpm josh issue:scout "<title>" --body-file <draft.md>`, each',
		'candidate read with `pnpm josh issue:read <N>`): when one does, fold its causes into it by',
		'`.claude/skills/workflow-commands/issue-fold-existing.md` instead of filing, the appended part',
		`carrying \`${lane_line}\`${labeling}; on a verdict other than \`fold\`, file as below.`,
		'File each other issue with',
		`\`pnpm josh issue:file --found-during ${String(issue)}\`, its body carrying those four per cause, and`,
		`\`${lane_line}\` under its background heading.`,
	].join(' ')
}

// One line: `detached_launch` lets a prompt break lines, but a single line keeps the log header whole.
function prompt(issue: number, minutes: number): string {
	const cite = issue_cite.plain(issue)
	const lane_line = `- 原因のレーン: ${String(minutes)} 分（${cite}）`

	return [
		reading(issue, cite, minutes),
		grouping(issue, lane_line, minutes),
		'On a duplicate refusal, read each candidate with `pnpm josh issue:read <N>`: one that only fixes',
		'another mechanism, or is only cited, is distinct — reissue with `--distinct <N,…>`; an open one that',
		'fixes the same mechanism is not filed again but gets a comment recording the recurrence with those four',
		'and the causing-lane line; one closed before this lane yet recurring here is filed anew as a',
		'recurrence, its number in `--distinct`. A cap refusal is final: stop filing.',
		`Then record the result: \`pnpm josh run:event --append note "${run_event_overrun.ended_text(issue, '<result>')}"\`,`,
		`the result being \`${run_event_overrun.folded_result(['<A>', '<B>'])}\` naming every issue you folded into`,
		`when you folded any, else \`${run_event_overrun.FILED_RESULT}\` when you filed any, \`${run_event_overrun.recurred_result('<N>')}\``,
		`when you only commented a recurrence on #<N>, else \`${run_event_overrun.none_result('<why, in about 15 characters>')}\`.`,
	].join(' ')
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
