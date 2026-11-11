import { backlog_hold_codes } from './backlog-hold-codes'
import { backlog_wait_cause, type WaitCause } from './backlog-wait-cause'

// A ledger hold reason as a sentence a person reads (joshuafolkken/kit#7287): what keeps a free lane
// empty and who fills it. The ledger keeps the code — `lane:stats` and the gap readers key on it — so
// only the board's seat line and the stall notice translate, here. An unknown code reads as itself.
//
// The writers' own constants name the codes (`backlog-hold-codes.ts`).

const {
	DRIVERLESS_PREFIX,
	HAND_BACK_PREFIX,
	MEMORY_REASON,
	OFFER_PREFIX,
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
	['window', "the run's time window closed; the session restarts the driver"],
])

// `offer:<verdict>:<detail>`: the offer started nothing, for its cause or its answer.
const OFFER_TEXT: ReadonlyMap<string, string> = new Map([
	['solo', 'a run:solo issue must finish first'],
	['blocked', 'every queued issue is blocked'],
	['exhausted', 'the backlog has nothing left to start'],
	['untriaged', AWAIT_TRIAGE],
	['parked', 'parked issues await your decision'],
	['unreadable', 'the backlog could not be read'],
])

// A wait-cause detail (`chain`, `gate+lane`, …, `backlog-wait-cause.ts`) names each of its causes.
const CAUSE_TEXT: Readonly<Record<WaitCause, string>> = {
	chain: 'other issues',
	gate: 'a start condition',
	lane: 'a running lane',
}
const CAUSE_JOINER = ' or '

const MEMORY_TEXT = 'memory pressure is high; lanes resume when it eases'
const USAGE_LIMIT_TEXT = 'the usage limit is reached; lanes resume when it resets'
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

// `rest` is `<verdict>[:<detail>]`; a detail neither the table nor a wait cause knows names the whole.
function offer_text(rest: string): string {
	const index = rest.indexOf(REASON_SEPARATOR)
	const detail = index === NOT_FOUND ? '' : rest.slice(index + REASON_SEPARATOR.length)

	return OFFER_TEXT.get(detail) ?? cause_text(detail) ?? `the backlog is waiting (${rest})`
}

function prefixed_text(code: string): string | undefined {
	const hand_back = rest_after(code, HAND_BACK_PREFIX)

	if (hand_back !== undefined) return hand_back_text(hand_back)

	const offer = rest_after(code, OFFER_PREFIX)

	return offer === undefined ? undefined : offer_text(offer)
}

function whole_text(code: string): string | undefined {
	if (code === MEMORY_REASON) return MEMORY_TEXT

	return code === USAGE_LIMIT_REASON ? USAGE_LIMIT_TEXT : undefined
}

// The sentence for a hold code; a `driverless:` code is the mark's own sentence after a missing driver.
function text_of(code: string): string {
	if (code.startsWith(DRIVERLESS_PREFIX)) {
		return `${DRIVERLESS_TEXT}; ${text_of(code.slice(DRIVERLESS_PREFIX.length))}`
	}

	return prefixed_text(code) ?? whole_text(code) ?? code
}

const backlog_hold_text = { text_of }

export { backlog_hold_text }
