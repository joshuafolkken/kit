import { epic_solo } from '#scripts/epic/epic-solo'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import type { BacklogAnswer } from './backlog-budget'
import { backlog_next } from './backlog-next'
import { backlog_wait_cause } from './backlog-wait-cause'

// The mechanical half of `josh backlog:offer`: turn what `backlog:next`
// answered — its stdout tokens and its exit code — into the one word `backlog:budget` is then asked
// with, plus the issue numbers to start and the consecutive-retry count carried to the next ask.
//
// **The mapping is `docs/josh-commands-backlog.md` → "`josh backlog:offer`", held here so it cannot
// drift.** It fixes which `backlog:next` answer becomes which `backlog:budget` word, and it carries two
// context branches an agent would otherwise apply by hand every iteration: `wait` is `blocked` while
// this run has children in flight and `exhausted` when it has none, and `retry` is `blocked` until the
// third consecutive one, which is `unreadable`. Both are decided from a count here rather than from a
// judgement.

// Three consecutive `retry` answers end the run: below that a transport hiccup is re-asked, at it the
// outage is not a hiccup. "`josh backlog:offer`" is the single source of the count.
const RETRY_LIMIT = 3
const FAILURE_EXIT_CODE = 1
const NO_RETRIES = 0

const TOKENS = backlog_next.VERDICT_TOKENS

const BLOCKED_ANSWER = 'blocked'
const SOLO_CAUSE = 'solo'

// `backlog:next`'s captured result: the exit code, the trimmed stdout as one token per line, and the
// stderr its explanations went to.
interface NextRead {
	code: number
	tokens: ReadonlyArray<string>
	err?: string | undefined
}

interface OfferAnswer {
	answer: BacklogAnswer
	issues: ReadonlyArray<string>
	// The consecutive-retry count after this ask — reset to zero by any answer that is not `retry`.
	retries: number
	// Why a `wait` answer started nothing, where `backlog:next` said: `solo` for the `run:solo` gate,
	// so `lane:stats` rows that wait apart from every other one (joshuafolkken/kit#4396); `chain`,
	// `gate` or `chain+gate` for the waits `backlog-wait-cause.ts` names (joshuafolkken/kit#4513).
	cause?: string
	// The issues a `chain` / `gate` cause waited on, recorded with the hold.
	waiting?: ReadonlyArray<number> | undefined
	// Whether `backlog:next` held an untriaged candidate back while offering the triaged ones — its
	// trailing `triage` line — so the judgment session is started beside the lanes.
	is_judgment_owed?: boolean
}

// The verdict words that map to one answer regardless of context. `wait` and `retry` are the two that
// do not, and they are handled by their own functions below.
const VERDICT_ANSWERS: Readonly<Record<string, BacklogAnswer>> = {
	[TOKENS.complete]: 'exhausted',
	[TOKENS.error]: 'unreadable',
	[TOKENS.stop]: 'parked',
	[TOKENS.triage]: 'untriaged',
}

// `wait` is `blocked` while this run has children in flight and `exhausted` when it does not — the
// mapping `backlog:budget` states, decided from the running count alone.
function wait_answer(running: number): BacklogAnswer {
	return running > 0 ? BLOCKED_ANSWER : 'exhausted'
}

// An unrecognized token is read as `unreadable` rather than guessed at: an answer the loop cannot
// place must end the run, not silently start work.
function verdict_answer(token: string, running: number): BacklogAnswer {
	if (token === TOKENS.wait) return wait_answer(running)

	return VERDICT_ANSWERS[token] ?? 'unreadable'
}

// A single verdict token, with the retry count advanced. `retry` is the only token that carries the
// count forward; every other resets it, because the count is of *consecutive* retries.
function from_verdict(token: string, running: number, retries: number): OfferAnswer {
	if (token === TOKENS.retry) {
		const next = retries + 1

		return { answer: next >= RETRY_LIMIT ? 'unreadable' : 'blocked', issues: [], retries: next }
	}

	return { answer: verdict_answer(token, running), issues: [], retries: NO_RETRIES }
}

function is_numbers(tokens: ReadonlyArray<string>): boolean {
	return tokens.length > 0 && tokens.every((token) => issue_number_shape.is_issue_number(token))
}

// The tokens before a trailing `triage` line: `backlog:next` names the triaged candidates it offers and
// then the judgment it still owes for the untriaged one it held back.
function without_triage(tokens: ReadonlyArray<string>): ReadonlyArray<string> {
	return tokens.at(-1) === TOKENS.triage ? tokens.slice(0, -1) : tokens
}

// What `backlog:next`'s stderr says a blocked wait was for: the `run:solo` gate's notice first, then
// the waiting issues' causes, or nothing when it names neither.
function blocked_cause(error: string): Pick<OfferAnswer, 'cause' | 'waiting'> {
	if (epic_solo.is_solo_wait(error)) return { cause: SOLO_CAUSE }

	const causes = backlog_wait_cause.parse(error)
	const tag = backlog_wait_cause.tag_of(causes)

	return tag === undefined ? {} : { cause: tag, waiting: backlog_wait_cause.numbers_of(causes) }
}

// A `wait` answer marked with its cause. An `exhausted` wait is marked too: the idle watch it opens
// holds a free lane as long as a `blocked` one, and a hold with nothing in flight here (a start date,
// or a blocker another session runs) is still that wait, not an empty backlog.
function with_cause(offer: OfferAnswer, token: string, error: string): OfferAnswer {
	return token === TOKENS.wait ? { ...offer, ...blocked_cause(error) } : offer
}

// **Read the exit code before the tokens.** Exit 1 is "the listing could not be read", which is never
// an empty backlog — reading it as `none` would report an emptiness that was never seen, so it maps to
// `unreadable`, and a stray stdout line on that path cannot be mistaken for an issue number.
function answer_of(read: NextRead, running: number, retries: number): OfferAnswer {
	if (read.code === FAILURE_EXIT_CODE) {
		return { answer: 'unreadable', issues: [], retries: NO_RETRIES }
	}

	const numbers = without_triage(read.tokens)

	if (is_numbers(numbers)) {
		const is_judgment_owed = numbers.length < read.tokens.length

		return { answer: 'candidates', issues: numbers, retries: NO_RETRIES, is_judgment_owed }
	}

	const token = read.tokens[0] ?? ''

	return with_cause(from_verdict(token, running, retries), token, read.err ?? '')
}

const backlog_offer = { RETRY_LIMIT, answer_of, verdict_answer, wait_answer }

export type { NextRead, OfferAnswer }
export { backlog_offer }
