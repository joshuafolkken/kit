import { issue_cite } from '#scripts/issue/issue-cite'
import type { HoldCause } from '#scripts/run/merge/run-merge-usage-limit'
import { backlog_hold_codes } from './backlog-hold-codes'
import { backlog_wait_cause, type WaitCause } from './backlog-wait-cause'

// A ledger hold reason as a sentence a person reads (joshuafolkken/kit#7287): what keeps a free lane
// empty and who fills it. The ledger keeps the code — `lane:stats` and the gap readers key on it — so
// only the board's seat line and the stall notice translate, here. An unknown code reads as itself.
//
// The writers' own constants name the codes (`backlog-hold-codes.ts`).

const {
	DRAINED_REASON,
	DRIVERLESS_PREFIX,
	HAND_BACK_PREFIX,
	MAIN_DIRTY_REASON,
	MEMORY_REASON,
	NAMED_WAIT,
	OFFER_PREFIX,
	ONLY_WAIT,
	REASON_SEPARATOR,
	USAGE_LIMIT_REASON,
} = backlog_hold_codes
const NOT_FOUND = -1
const AWAIT_TRIAGE = 'open issues await your triage'

// `hand-back:<reason>`: the driver ended and left the lanes to a session.
const HAND_BACK_TEXT: ReadonlyMap<string, string> = new Map([
	['judge', AWAIT_TRIAGE],
	['triage', 'a parked issue awaits your triage'],
	['merge', 'the driver paused after a merge; the session restarts it'],
	['launch', 'a lane launch failed; the session restarts the driver'],
	['offer', 'the backlog offer failed; the session restarts the driver'],
	// The supervisor re-drives a window's end with no session (`run-wake-driver.ts`); a drain is a window's
	// end whose latest offer started nothing (joshuafolkken/kit#9003).
	['window', "the run's time window closed; the supervisor restarts the driver"],
	[DRAINED_REASON, 'the backlog had nothing to start; the supervisor restarts the driver'],
])
// The hand-backs only a person ends; every other one ends when the driver restarts.
const PERSON_HAND_BACKS: ReadonlySet<string> = new Set(['judge', 'triage'])

// `offer:<verdict>:<detail>`: the offer started nothing, for its cause or its answer.
const OFFER_TEXT: ReadonlyMap<string, string> = new Map([
	['solo', 'a run:solo issue must finish first'],
	['decision', 'an interrupt defect awaits your decision'],
	['blocked', 'every queued issue is blocked'],
	['exhausted', 'the backlog has nothing left to start'],
	['untriaged', AWAIT_TRIAGE],
	['parked', 'parked issues await your decision'],
	['unreadable', 'the backlog could not be read'],
	[ONLY_WAIT, 'the run closes once its named issues finish'],
])

// A wait-cause detail (`chain`, `gate+lane`, …, `backlog-wait-cause.ts`) names each of its causes.
const CAUSE_TEXT: Readonly<Record<WaitCause, string>> = {
	chain: 'other issues',
	gate: 'a start condition',
	publication: 'their publication',
	lane: 'a running lane',
}
const CAUSE_JOINER = ' or '

const MEMORY_TEXT = 'memory pressure is high; lanes resume when it eases'
const MAIN_DIRTY_TEXT =
	'the primary checkout has uncommitted changes; lanes resume once it is committed, stashed or held by a run'
const USAGE_LIMIT_TEXT = 'the usage limit is reached; lanes resume when it resets'
// A `usage-limit` hold an authentication failure caused (joshuafolkken/kit#8014): the recheck may clear
// it, and only a person's re-login ends one that keeps failing — the remedies Claude's own error names.
// The remedy leads, so a seat line cut to an 80-column pane still shows it.
const AUTH_FAILURE_TEXT =
	'auth failed; run `claude auth login` (or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`) if the recheck does not clear it'
const DRIVERLESS_TEXT = 'no driver is running'

// What follows `<prefix>:` in the code, or `undefined` when the code does not start with it.
function rest_after(code: string, prefix: string): string | undefined {
	const head = `${prefix}${REASON_SEPARATOR}`

	return code.startsWith(head) ? code.slice(head.length) : undefined
}

function hand_back_text(reason: string): string {
	return HAND_BACK_TEXT.get(reason) ?? `the driver paused (${reason}); the session restarts it`
}

function cause_text(detail: string): string | undefined {
	const causes = backlog_wait_cause.causes_of_tag(detail)

	if (causes === undefined) return undefined

	return `queued issues wait on ${causes.map((cause) => CAUSE_TEXT[cause]).join(CAUSE_JOINER)}`
}

// A `named:<N>` detail: the declared issue in flight holds the free lanes until it ends (joshuafolkken/kit#8863).
function named_text(detail: string): string | undefined {
	const issue = rest_after(detail, NAMED_WAIT)

	return issue === undefined
		? undefined
		: `named ${issue_cite.plain_for('terminal', issue)} runs first; the auto-ok queue starts when it ends`
}

function detail_text(detail: string): string | undefined {
	return OFFER_TEXT.get(detail) ?? cause_text(detail) ?? named_text(detail)
}

// `rest` is `<verdict>[:<detail>]`; a detail no reader above knows names the whole.
function offer_text(rest: string): string {
	const index = rest.indexOf(REASON_SEPARATOR)
	const detail = index === NOT_FOUND ? '' : rest.slice(index + REASON_SEPARATOR.length)

	return detail_text(detail) ?? `the backlog is waiting (${rest})`
}

function prefixed_text(code: string): string | undefined {
	const hand_back = rest_after(code, HAND_BACK_PREFIX)

	if (hand_back !== undefined) return hand_back_text(hand_back)

	const offer = rest_after(code, OFFER_PREFIX)

	return offer === undefined ? undefined : offer_text(offer)
}

function whole_text(code: string, cause: HoldCause | undefined): string | undefined {
	if (code === MEMORY_REASON) return MEMORY_TEXT
	if (code === MAIN_DIRTY_REASON) return MAIN_DIRTY_TEXT
	if (code !== USAGE_LIMIT_REASON) return undefined

	return cause === 'auth' ? AUTH_FAILURE_TEXT : USAGE_LIMIT_TEXT
}

// The sentence for a hold code; a `driverless:` code is the mark's own sentence after a missing driver.
// `cause` is what the usage-limit hold stops for (`run-merge-usage-limit.ts`); unread, it reads as a limit.
function text_of(code: string, cause?: HoldCause): string {
	if (code.startsWith(DRIVERLESS_PREFIX)) {
		return `${DRIVERLESS_TEXT}; ${text_of(code.slice(DRIVERLESS_PREFIX.length), cause)}`
	}

	return prefixed_text(code) ?? whole_text(code, cause) ?? code
}

// Whether the hold is the driver's hand-back a session restart ends, a driverless mark's included —
// told apart from a hand-back that waits on a person (joshuafolkken/kit#7510).
function is_driver_restart(code: string): boolean {
	const own = code.startsWith(DRIVERLESS_PREFIX) ? code.slice(DRIVERLESS_PREFIX.length) : code
	const reason = rest_after(own, HAND_BACK_PREFIX)

	return reason !== undefined && !PERSON_HAND_BACKS.has(reason)
}

const backlog_hold_text = { is_driver_restart, text_of }

export { backlog_hold_text }
