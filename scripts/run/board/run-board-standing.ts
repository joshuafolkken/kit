import { styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_progress_config } from '#scripts/run/progress/run-progress-config'
import { run_board_header_time, type OutageHeader } from './run-board-header-time'
import { run_board_labels } from './run-board-labels'
import type { BoardNote } from './run-board-notes'

// What holds over frames rather than sounding once (joshuafolkken/kit#8475) — the network down, the
// board's reads failing, the run's heartbeat gone quiet — said in fixed words in the header's notice
// slot, ahead of any notice, so a later cue never hides it and its end gives the slot back. A failure's
// reason, whose length no line can hold, is written as a finding instead.

const { HEADER_ICONS, span_of } = run_board_labels
const SEPARATOR = ' · '
const RETRYING = 'retrying'
// A reason no action is known for is retried this long before the slot points at the findings.
const RETRY_MINUTES = 5
const RETRY_MS = RETRY_MINUTES * MS_PER_MINUTE
// The heartbeat is missed once this many `run:progress` intervals pass with no event.
const GAP_FACTOR = 1.5
// Reasons only a person clears, and what they do.
const ACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/gh auth login|not logged in|authentication|HTTP 401/iu, 'gh auth login'],
	// `gh CLI is not installed` is `git-gh-check.ts`'s wording for a gh missing from the PATH.
	[/spawn gh ENOENT|gh: command not found|gh CLI is not installed/iu, 'gh not found'],
]
// Reasons that clear on their own as the board retries.
const TRANSIENT =
	/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed out|HTTP 5\d\d|rate limit/iu
// The digits a standing state counts, left out of the key it types by.
const DIGITS = /\d/gu

// What the slot reads: the time cells' header and the reads that failed.
interface StandingHeader extends OutageHeader {
	plan_fetched_ms?: number | undefined
	plan_failed_ms?: number | undefined
	plan_error?: string | undefined
	read_failed_ms?: number | undefined
	read_error?: string | undefined
}

// One read failing: since when the board has drawn it stale, when it last failed, and why.
interface Failure {
	word: string
	since_ms: number
	at_ms: number
	reason: string | undefined
}

// The reads off this machine first, which hold every row still; then the plan, stale since it last landed.
function failures_of(header: StandingHeader): Array<Failure> {
	const { read_failed_ms, plan_failed_ms } = header
	const read = { word: 'board', since_ms: read_failed_ms, at_ms: read_failed_ms }
	const plan_since = header.plan_fetched_ms ?? plan_failed_ms
	const plan = { word: 'plan', since_ms: plan_since, at_ms: plan_failed_ms }

	return [
		{ ...read, reason: header.read_error },
		{ ...plan, reason: header.plan_error },
	].filter((failure): failure is Failure => failure.at_ms !== undefined)
}

// Whether the board goes on retrying a reason no person clears: one known to clear by itself, or any
// other until it has held a while. A failure with no reason writes no finding to point at.
function retry_of(said: string, age_ms: number): string {
	if (said === '' || TRANSIENT.test(said) || age_ms < RETRY_MS) return RETRYING

	return 'see findings'
}

// What a person does about a reason, else whether the board is still retrying it.
function action_of(reason: string | undefined, age_ms: number): string {
	const said = reason ?? ''
	const action = ACTIONS.find(([pattern]) => pattern.test(said))

	return action === undefined ? retry_of(said, age_ms) : action[1]
}

function stale_part(header: StandingHeader): string | undefined {
	const [failure] = failures_of(header)

	if (failure === undefined) return undefined

	const age = header.now_ms - failure.since_ms
	const action = action_of(failure.reason, age)

	return `${HEADER_ICONS.warning} stale ${span_of(age)}${SEPARATOR}${action}`
}

function offline_part(header: StandingHeader): string | undefined {
	const age = run_board_header_time.offline_age(header)

	return age === undefined ? undefined : `${HEADER_ICONS.offline} ${span_of(age)}`
}

// Read once: the interval is the environment's or the repository's, which no frame changes.
const gap: { ms?: number } = {}

function gap_ms(): number {
	gap.ms ??= run_progress_config.configured_interval_ms() * GAP_FACTOR

	return gap.ms
}

// A run past its `run:progress` interval and half again with no event — waiting or working alike; an
// ended or stopped run keeps no heartbeat.
function heartbeat_part(header: StandingHeader): string | undefined {
	const age = run_board_header_time.age_of(header)

	if (age === undefined || header.activity.is_stopped) return undefined

	const minutes = String(Math.floor(age / MS_PER_MINUTE))

	return age > gap_ms() ? `${HEADER_ICONS.warning} no heartbeat ${minutes}′` : undefined
}

// The state the slot says, the one that explains the others first: an outage stalls the reads and the
// heartbeat, and a failed read stalls the heartbeat the board sees.
function words_of(header: StandingHeader): string | undefined {
	return offline_part(header) ?? stale_part(header) ?? heartbeat_part(header)
}

// The slot's words, drawn as the warning they are, and the words it is typed by — a state types once as
// it starts, not again as its age counts; none while nothing holds.
function slot_of(header: StandingHeader): readonly [string, string] | undefined {
	const words = words_of(header)

	return words === undefined
		? undefined
		: [styleText('yellow', words), words.replaceAll(DIGITS, '')]
}

// Each failing read's reason as a finding, at the moment it failed.
function notes_of(header: StandingHeader): Array<BoardNote> {
	return failures_of(header)
		.filter((failure) => failure.reason !== undefined && failure.reason !== '')
		.map((failure) => ({
			kind: 'note',
			at_ms: failure.at_ms,
			issue: undefined,
			text: `${failure.word} read failed: ${failure.reason ?? ''}`,
		}))
}

const run_board_standing = { notes_of, slot_of }

export { run_board_standing }
export type { StandingHeader }
