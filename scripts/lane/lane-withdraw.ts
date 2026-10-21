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
import { lane_residents } from './lane-residents'
import { lane_state } from './lane-state'

// `josh lane:withdraw <N> --reason <text>` — a person takes a running lane child's issue out of the
// current run: the child is stopped, its work stashed and the lane closed. **The Issue stays open** —
// a withdrawal ends this run's attempt, not the work — so a later run offers it again; this run does
// not (`backlog-drive-restore.ts` → `offer_exclude`, and the drive's own exclusion).
//
// **The `withdraw` event is written first, before anything is stopped.** Killing the child alone would
// let `lane:await` book it stopped and `run:merge` classify it from GitHub — an open issue resumed as an
// `outage` or parked `run:stalled`. `run:merge` reads the event stream before GitHub, so a child whose
// newest launch-or-withdraw event is a withdraw is booked `withdrawn` whatever the Issue's state reads.
//
// A tree that could not be stashed is left in place: closing the lane would delete the work, and the
// person decides what to keep.

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
	// Whether the comment saying the issue stays open reached it.
	is_noted: boolean
	lane: CloseKind
	// What else the close ended from the checkout; `undefined` where it could not be read.
	residents: ReadonlyArray<number> | undefined
}

type Refused =
	{ kind: typeof CLOSED_KIND } | { kind: typeof NO_LANE_KIND } | { kind: typeof UNREADABLE_KIND }
type WithdrawOutcome = Withdrawn | Unsaved | Refused

function withdraw_comment(reason: string): string {
	return [
		'Withdrawn from the current run by a person with `pnpm josh lane:withdraw`.',
		'Its lane child was stopped and the lane closed. The Issue stays open: this run does not resume it, and the next run offers it again.',
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

async function note_issue(
	issue: string,
	reason: string,
	stash: string | undefined,
): Promise<boolean> {
	const is_noted = await git_gh_issue_write.issue_try_comment(issue, withdraw_comment(reason))

	if (stash !== undefined) await lane_preserve.announce(issue, stash, WITHDRAW_CAUSE)
	await run_label.unmark(issue)

	return is_noted
}

async function stop_and_close(lane: LaneInfo, reason: string): Promise<WithdrawOutcome> {
	await record_withdraw(lane.issue, reason)
	const reaped = lane_reap.reap_child(lane).length
	const saved = await lane_preserve.keep_work(lane.issue, lane.directory, WITHDRAW_OCCASION)

	if (saved.kind === 'unsaved') return saved
	const is_noted = await note_issue(lane.issue, reason, saved.stash)
	const closed = await lane_close.close_lane(lane.issue)

	// After the close, so the record names the withdrawal rather than the close it ran. An `incomplete`
	// close is not `ended`: the supervisor closes the lane again until its last process is gone.
	if (closed.kind !== 'incomplete') {
		await lane_state.record_change({ issue: lane.issue, state: 'ended', command: 'lane:withdraw' })
	}

	return {
		kind: 'withdrawn',
		reaped,
		stash: saved.stash,
		is_noted,
		lane: closed.kind,
		residents: closed.residents,
	}
}

/** Stop `#<N>`'s lane child, stash its work and close the lane, leaving the Issue open. */
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

// What the lane's close left or ended, as a suffix.
function lane_suffix(outcome: Withdrawn, cited: string): string {
	const removed = outcome.lane === 'incomplete' ? ' The lane could not be fully removed.' : ''
	const residents = lane_residents.residents_sentence(outcome.residents, cited)

	return residents === undefined ? removed : `${removed} ${residents}`
}

function withdrawn_text(outcome: Withdrawn, issue: string): string {
	const cited = session_cite.issue(issue)
	const stopped = outcome.reaped === 0 ? 'Its child had already ended.' : 'Stopped its child.'
	const head = `Withdrew ${cited}. ${stopped} ${stash_sentence(outcome.stash)}`
	const lane = lane_suffix(outcome, cited)
	const noted = outcome.is_noted ? '' : ' The comment saying so could not be posted.'

	return `${head} The Issue stays open: this run does not offer it again, the next run does.${noted}${lane}`
}

function unsaved_text(outcome: Unsaved, issue: string): string {
	return `The child for ${session_cite.issue(issue)} was stopped, but its uncommitted work could not be stashed (${outcome.reason}), so the lane is left at ${outcome.directory}; \`run:merge\` books it withdrawn.`
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
