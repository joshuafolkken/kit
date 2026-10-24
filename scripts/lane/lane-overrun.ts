import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_priority } from '#scripts/issue/issue-priority'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger } from './lane-ledger'
import { lane_net_time } from './lane-net-time'

// A merged lane over the high-priority threshold of net time is investigated for its causes
// (joshuafolkken/kit#4751). `run:merge` asks at each merge: a lane at or under the threshold — its long
// total spent waiting on a person or an outage included — stops here, before any record of it is read.
// An overrun launches a detached worker session that reads the lane's records and files each unfiled
// cause through `issue:file`, so the next lane starts without waiting on it. The session carries the
// lane's child mark, which makes `issue:file` count its filings against the lane (`issue-file-cap.ts`),
// and `--found-during` names the same origin. The launch and the session's result both go on the run's
// event stream as notes.

const { EVENT_KIND } = run_event_stream
const LOG_PREFIX = 'josh-lane-overrun-'
const LOG_SUFFIX = '.log'

function is_overrun(minutes: number | undefined): minutes is number {
	return minutes !== undefined && minutes > issue_priority.HIGH_LANE_MINUTES
}

function overran_text(issue: number): string {
	return `${issue_cite.plain(issue)} overran:`
}

// A merge `run:merge` collects again — a driver retry, a parent's hand run — finds its lane's launch
// note on the stream and launches no second session to file the same causes.
function is_launched(events: ReadonlyArray<RunEvent>, issue: number): boolean {
	return events.some(
		(event) => event.kind === EVENT_KIND.NOTE && event.text.startsWith(overran_text(issue)),
	)
}

// The minutes of a lane not yet investigated, or `undefined` when there is nothing to ask.
async function net_minutes_of(issue: number): Promise<number | undefined> {
	const path = await lane_ledger.target()

	if (path === undefined) return undefined

	const events = await run_event_stream_emit.all_events()

	if (is_launched(events, issue)) return undefined

	return lane_net_time.net_minutes(lane_ledger.read_entries(path), events, issue)
}

function transcript_directories(issue: number): ReadonlyArray<string> {
	const main_cwd = cost_transcript.session_cwd(process.cwd())
	const home = cost_transcript.home_directory()
	const suffix = `-${String(issue)}`

	return cost_transcript
		.lane_transcript_directories(main_cwd, home)
		.filter((directory) => directory.endsWith(suffix))
}

// One line: `detached_launch` lets a prompt break lines, but a single line keeps the log header whole.
function prompt(issue: number, minutes: number): string {
	const cite = issue_cite.plain(issue)
	const directories = transcript_directories(issue).join(', ') || 'none found'

	return [
		`Investigate why lane ${cite} took ${String(minutes)} minutes of net time (dispatch to merge, less`,
		'its waits on a person and on outages). Leave this checkout as it is: write any file, an issue body',
		'included, under the system temp directory, and never stage, commit or push.',
		`Read the lane's transcripts (${directories}), its ship log (\`pnpm josh ship --log ${String(issue)}\`)`,
		'and the run events (`pnpm josh run:event --from 0`), and find the causes that spent time other than',
		'waiting. Trace each cause to what can fix it: the span it spent, the signal that led to the wrong call',
		'or the wait (which command printed what), the `file:line` of the code or document that decided it, and',
		`where to fix it. File each cause with \`pnpm josh issue:file --found-during ${String(issue)}\`, its body`,
		`carrying those four, and \`- 原因のレーン: ${String(minutes)} 分（${cite}）\` under its background heading.`,
		'On a duplicate refusal, read each candidate with `pnpm josh issue:read <N>`: one that only fixes',
		'another mechanism, or is only cited, is distinct — reissue with `--distinct <N,…>`; an open one that',
		'fixes the same mechanism is not filed again but gets a comment recording the recurrence with those four',
		'and the causing-lane line; one closed before this lane yet recurring here is filed anew as a',
		'recurrence, its number in `--distinct`. A cap refusal is final: stop filing.',
		`Then record the result: \`pnpm josh run:event --append note "${cite} overrun: <the issues filed, or`,
		'why none was filed>"`.',
	].join(' ')
}

function log_path(issue: number): string {
	return stamp_file.stamp_path(`${LOG_PREFIX}${String(issue)}-`, PROJECT_ROOT, LOG_SUFFIX)
}

function note_failure(issue: number): (note: string) => void {
	return (note) => {
		void run_event_stream_emit.emit(
			EVENT_KIND.NOTE,
			`${issue_cite.plain(issue)} overrun investigation failed: ${note}`,
		)
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
		? `investigating in pid ${String(result.pid)}`
		: `not investigated: ${result.note}`
}

async function investigate_lane(issue: number): Promise<void> {
	const minutes = await net_minutes_of(issue)

	if (!is_overrun(minutes)) return

	const outcome = launched(issue, minutes)

	await run_event_stream_emit.emit(
		EVENT_KIND.NOTE,
		`${overran_text(issue)} ${String(minutes)} min net — ${outcome}`,
	)
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
