import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_label } from '#scripts/run/run-label'
import { lane_close, type CloseKind } from './lane-close'
import { lane_preserve, type KeptWork } from './lane-preserve'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_state } from './lane-state'

// `josh lane:withdraw <N> --reason <text>` — a person takes a running lane child's issue out of the run
// for good: the child is stopped, its work stashed, the Issue closed as not planned and the lane closed.
//
// **The `withdraw` event is written first, before anything is stopped.** Killing the child alone would
// let `lane:await` book it stopped and `run:merge` classify it from GitHub — an open issue resumed as an
// `outage` or parked `run:stalled`. `run:merge` reads the event stream before GitHub, so a child whose
// newest launch-or-withdraw event is a withdraw is booked `withdrawn` whatever the Issue's state reads
// at that moment, and the race between the kill and the close cannot book it as anything else.
//
// **The issue is read again once the child is stopped.** It may merge between the first read and the
// reap; the reap stopped it, so the second read is final, and an issue it already closed keeps
// GitHub's close — `run:merge` books a merged close as merged whatever the event stream says.
//
// A tree that could not be stashed is left in place with the Issue open: closing the lane would delete
// the work, and the person decides what to keep.

const WITHDRAW_OCCASION = 'lane withdraw'
const WITHDRAW_CAUSE = 'a person withdrew it with `lane:withdraw`'
const CLOSED_STATE = 'CLOSED'
const CLOSED_KIND = 'closed'
const NO_LANE_KIND = 'no-lane'
const UNREADABLE_KIND = 'unreadable'

type Unsaved = Extract<KeptWork, { kind: 'unsaved' }>

interface Withdrawn {
	kind: 'withdrawn'
	// How many of the child's processes the withdrawal stopped — 0 for a child that had already ended.
	reaped: number
	stash: string | undefined
	is_closed: boolean
	// The issue had closed on its own — merged — before the withdrawal reached it, so it was left as is.
	had_closed: boolean
	lane: CloseKind
}

type IssueSettled = Pick<Withdrawn, 'had_closed' | 'is_closed'>

type Refused =
	{ kind: typeof CLOSED_KIND } | { kind: typeof NO_LANE_KIND } | { kind: typeof UNREADABLE_KIND }
type WithdrawOutcome = Withdrawn | Unsaved | Refused

function close_comment(reason: string): string {
	return [
		'Withdrawn by a person with `pnpm josh lane:withdraw`.',
		'Its lane child was stopped and the lane closed.',
		`- Why: ${reason}`,
	].join('\n')
}

async function record_withdraw(issue: string, reason: string): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.WITHDRAW,
		`${issue_cite.plain(issue)} withdrawn by a person: ${reason}`,
	)
}

// A closed issue has nothing to withdraw, and an unread one might be: neither writes anything.
async function refusal_of(issue: string): Promise<Refused | undefined> {
	const read = await issue_state_cli.read_issue(issue)

	if (read.kind !== 'state') return { kind: UNREADABLE_KIND }
	if (read.state.state.toUpperCase() === CLOSED_STATE) return { kind: CLOSED_KIND }

	return undefined
}

async function close_open_issue(issue: string, reason: string): Promise<IssueSettled> {
	const refusal = await refusal_of(issue)

	// An unread issue may have merged during the reap, so it is left open for a person to close.
	if (refusal !== undefined) {
		const is_closed = refusal.kind === CLOSED_KIND

		return { is_closed, had_closed: is_closed }
	}

	const is_closed = await git_gh_issue_write.issue_close_not_planned(issue, close_comment(reason))

	return { is_closed, had_closed: false }
}

async function close_issue(
	issue: string,
	reason: string,
	stash: string | undefined,
): Promise<IssueSettled> {
	const settled = await close_open_issue(issue, reason)

	if (stash !== undefined) await lane_preserve.announce(issue, stash, WITHDRAW_CAUSE)
	await run_label.unmark(issue)

	return settled
}

async function stop_and_close(lane: LaneInfo, reason: string): Promise<WithdrawOutcome> {
	await record_withdraw(lane.issue, reason)
	const reaped = lane_reap.reap_child(lane).length
	const saved = await lane_preserve.keep_work(lane.issue, lane.directory, WITHDRAW_OCCASION)

	if (saved.kind === 'unsaved') return saved
	const settled = await close_issue(lane.issue, reason, saved.stash)
	const closed = await lane_close.close_lane(lane.issue)

	// After the close, so the record names the withdrawal rather than the close it ran.
	await lane_state.record_change({ issue: lane.issue, state: 'ended', command: 'lane:withdraw' })

	return { kind: 'withdrawn', reaped, stash: saved.stash, ...settled, lane: closed.kind }
}

/** Stop `#<N>`'s lane child, stash its work, close the Issue as not planned and close the lane. */
async function withdraw(issue: string, reason: string): Promise<WithdrawOutcome> {
	issue_number_shape.require_issue_number(issue)
	const refusal = await refusal_of(issue)

	if (refusal !== undefined) return refusal
	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return { kind: NO_LANE_KIND }

	return await stop_and_close(lane, reason)
}

function stash_sentence(stash: string | undefined): string {
	if (stash === undefined) return 'The lane held no uncommitted work.'

	return `Its uncommitted work was stashed — recover with \`pnpm josh stash:pop "${stash}"\`.`
}

function withdrawn_text(outcome: Withdrawn, issue: string): string {
	const cited = session_cite.issue(issue)
	const stopped = outcome.reaped === 0 ? 'Its child had already ended.' : 'Stopped its child.'
	const head = `Withdrew ${cited}. ${stopped} ${stash_sentence(outcome.stash)}`
	const lane = outcome.lane === 'incomplete' ? ' The lane could not be fully removed.' : ''

	if (outcome.had_closed) return `${head} The Issue had already closed and was left as is.${lane}`

	if (outcome.is_closed) return `${head} The Issue is closed as not planned.${lane}`

	return `${head} The Issue could not be closed — close ${cited} by hand; \`run:merge\` books it withdrawn either way.${lane}`
}

function unsaved_text(outcome: Unsaved, issue: string): string {
	return `The child for ${session_cite.issue(issue)} was stopped, but its uncommitted work could not be stashed (${outcome.reason}), so the Issue is left open and the lane at ${outcome.directory}; \`run:merge\` books it withdrawn.`
}

function refused_text(outcome: Refused, issue: string): string {
	const cited = session_cite.issue(issue)

	if (outcome.kind === CLOSED_KIND) {
		return `${cited} is already closed, so there is nothing to withdraw.`
	}

	if (outcome.kind === NO_LANE_KIND) {
		return `No lane is open for ${cited}, so there is no child to withdraw.`
	}

	return `The state of ${cited} could not be read, so nothing was stopped or closed — try again.`
}

function describe(outcome: WithdrawOutcome, issue: string): string {
	if (outcome.kind === 'unsaved') return unsaved_text(outcome, issue)

	return outcome.kind === 'withdrawn'
		? withdrawn_text(outcome, issue)
		: refused_text(outcome, issue)
}

const lane_withdraw = { describe, withdraw }

export type { WithdrawOutcome }
export { lane_withdraw }
