import { api_auth } from '#scripts/agent/api-auth'
import { api_outage } from '#scripts/agent/api-outage'
import { api_usage_limit } from '#scripts/agent/api-usage-limit'
import { issue_closing_pr } from '#scripts/issue/issue-closing-pr'
import { issue_merged } from '#scripts/issue/issue-merged'
import type { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ending } from '#scripts/run/run-ending'
import { run_merge, type ChildOutcome, type EndingSignals } from './run-merge'
import { run_merge_cap } from './run-merge-cap'
import { run_merge_restart } from './run-merge-restart'
import { run_merge_ship } from './run-merge-ship'
import { run_merge_steps, type MergeContext } from './run-merge-steps'

// What `run:merge` reads beside a returned child's GitHub state before classifying it — the exit
// record, the lane's cut, a merged closing pull request and a person's withdrawal — and the
// classification those readings and the state decide (`run_merge.classify_child`).

type IssueRead = Awaited<ReturnType<typeof issue_state_cli.read_issue>>

// Whether the child's session ended through its environment — read only when `--output` named the
// transcript, off otherwise: its exit record shows it could not reach the API, or the session was
// killed inside a turn. The path is validated inside `run_ending`, so a missing output is "no".
function read_is_outage(output: string | undefined): boolean {
	if (output === undefined) return false

	return api_outage.is_outage(run_ending.read_exit(output)) || run_ending.ended_mid_turn(output)
}

// Whether the child's session ended because it could not authenticate — off without `--output`, as the
// outage read is. The lane's log is appended across launches, so it is read as the reviewer's is
// (`api_auth.is_auth_failed_transcript`).
function read_is_auth_failure(output: string | undefined): boolean {
	if (output === undefined) return false

	return api_auth.is_auth_failed_transcript(run_ending.read_transcript(output))
}

// Why an unfinished child is re-dispatchable, or `undefined` when it is not. **Only an API outage adds
// to the run-wide streak**: a host restart is over by the time the child is read (joshuafolkken/kit#4540),
// and an unanswered ship stop reached the API (joshuafolkken/kit#3974).
async function retry_cause(
	child: string,
	output: string | undefined,
): Promise<'api' | 'exempt' | undefined> {
	if (await run_merge_restart.is_host_restart(child, output)) return 'exempt'

	if (read_is_outage(output)) return 'api'

	return (await run_merge_ship.is_unanswered(child, output)) ? 'exempt' : undefined
}

// An outage child is re-dispatched only so many times: one that ends the same way on every dispatch is
// parked, since merges in other lanes reset the run-wide outage streak and would never stop it. Its park
// says so (`run-merge-cap.ts`).
async function read_retryable(
	child: string,
	output: string | undefined,
): Promise<Pick<EndingSignals, 'is_outage' | 'is_streak_exempt' | 'capped_note'>> {
	const cause = await retry_cause(child, output)

	if (cause === undefined) return { is_outage: false, is_streak_exempt: false }

	const events = await run_event_stream_emit.current_events()
	const limit = run_merge.CONSECUTIVE_OUTAGE_LIMIT

	if (run_merge_cap.outages(events, child) >= limit) {
		return { is_outage: false, capped_note: run_merge_cap.note_of(events, child, limit) }
	}

	return { is_outage: true, is_streak_exempt: cause === 'exempt' }
}

// The timeline is read only for an OPEN, unparked child — the one classification a merged closing pull
// request changes. A CLOSED child was closed by GitHub, so it must carry no `merged_pr` for
// `do_merged` to close again.
async function read_merged_pr(child: string, read: IssueRead): Promise<string | undefined> {
	if (read.kind !== 'state' || run_merge.classify_child(read.state) !== 'failed') return undefined

	return await issue_closing_pr.read_closing_pr(child)
}

// A child that merged before `lane:withdraw` stopped it is merged, not withdrawn: the withdrawal's
// event is already written, so only the timeline tells its merged close from the not-planned one. An
// unread timeline answers `undefined`, and `outcome_of` asks again rather than guessing.
async function read_is_withdrawn(child: string, read: IssueRead): Promise<boolean | undefined> {
	const events = await run_event_stream_emit.current_events()

	if (!run_event_scope.is_withdrawn(events, child)) return false
	if (read.kind !== 'state' || run_merge.classify_child(read.state) !== 'merged') return true
	const is_merged = await issue_merged.read_merge_state(child)

	return is_merged === undefined ? undefined : !is_merged
}

// When a usage limit that stopped the child resets — off without `--output`, as the outage read is. The
// reset is read from the transcript's last write, not from this late collection of it.
function read_resume_ms(output: string | undefined): number | undefined {
	if (output === undefined) return undefined
	const transcript = run_ending.read_transcript(output)

	return api_usage_limit.transcript_resume_ms(transcript, Date.now(), run_ending.written_at(output))
}

async function read_signals(ctx: MergeContext, read: IssueRead): Promise<EndingSignals> {
	const [is_cut, merged_pr, retryable, is_withdrawn] = await Promise.all([
		run_merge_steps.has_resumable_cut(ctx.child),
		read_merged_pr(ctx.child, read),
		read_retryable(ctx.child, ctx.output),
		read_is_withdrawn(ctx.child, read),
	])

	const is_auth_failure = read_is_auth_failure(ctx.output)
	const resume_ms = read_resume_ms(ctx.output)

	return { ...retryable, is_cut, merged_pr, is_withdrawn, is_auth_failure, resume_ms }
}

// An unread state is `unresolved` unless a withdrawal already settled the child, which is read locally;
// a withdrawn child whose timeline could not tell its merge (`is_withdrawn` unset) is `unresolved` too.
function outcome_of(read: IssueRead, signals: EndingSignals): ChildOutcome {
	if (signals.is_withdrawn === undefined) return 'unresolved'

	return run_merge.classify_child(read.kind === 'state' ? read.state : undefined, signals)
}

const run_merge_signals = { outcome_of, read_merged_pr, read_signals }

export { run_merge_signals }
