import type { BacklogAnswer } from './backlog-budget'
import { backlog_next } from './backlog-next'

// The mechanical half of `josh backlog:offer` (joshuafolkken/kit#2162): turn what `backlog:next`
// answered — its stdout tokens and its exit code — into the one word `backlog:budget` is then asked
// with, plus the issue numbers to start and the consecutive-retry count carried to the next ask.
//
// **The mapping is `backlogrun-steps.md` → "The loop"'s table, held here so it cannot drift.** That table
// fixed which `backlog:next` answer becomes which `backlog:budget` word, and it carried two context
// branches an agent had to apply by hand every iteration: `wait` is `blocked` while this run has
// children in flight and `exhausted` when it has none, and `retry` is `blocked` until the third
// consecutive one, which is `unreadable`. Both are decided from a count here rather than from a
// judgement.

// Three consecutive `retry` answers end the run: below that a transport hiccup is re-asked, at it the
// outage is not a hiccup. `backlogrun-steps.md` → "The loop" is the single source of the count.
const RETRY_LIMIT = 3
const FAILURE_EXIT_CODE = 1
const NO_RETRIES = 0
const NUMBER_PATTERN = /^[1-9]\d*$/u

const TOKENS = backlog_next.VERDICT_TOKENS

// `backlog:next`'s captured result: the exit code, and the trimmed stdout as one token per line.
interface NextRead {
	code: number
	tokens: ReadonlyArray<string>
}

interface OfferAnswer {
	answer: BacklogAnswer
	issues: ReadonlyArray<string>
	// The consecutive-retry count after this ask — reset to zero by any answer that is not `retry`.
	retries: number
}

// The verdict words that map to one answer regardless of context. `wait` and `retry` are the two that
// do not, and they are handled by their own functions below.
const VERDICT_ANSWERS: Readonly<Record<string, BacklogAnswer>> = {
	[TOKENS.complete]: 'exhausted',
	[TOKENS.error]: 'unreadable',
	[TOKENS.stop]: 'parked',
}

// `wait` is `blocked` while this run has children in flight and `exhausted` when it does not — the
// mapping `backlog:budget` states, decided from the running count alone.
function wait_answer(running: number): BacklogAnswer {
	return running > 0 ? 'blocked' : 'exhausted'
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
	return tokens.length > 0 && tokens.every((token) => NUMBER_PATTERN.test(token))
}

// **Read the exit code before the tokens.** Exit 1 is "the listing could not be read", which is never
// an empty backlog — reading it as `none` would report an emptiness that was never seen, so it maps to
// `unreadable`, and a stray stdout line on that path cannot be mistaken for an issue number.
function answer_of(read: NextRead, running: number, retries: number): OfferAnswer {
	if (read.code === FAILURE_EXIT_CODE) {
		return { answer: 'unreadable', issues: [], retries: NO_RETRIES }
	}

	if (is_numbers(read.tokens)) {
		return { answer: 'candidates', issues: read.tokens, retries: NO_RETRIES }
	}

	return from_verdict(read.tokens[0] ?? '', running, retries)
}

const backlog_offer = { RETRY_LIMIT, answer_of, verdict_answer, wait_answer }

export type { NextRead, OfferAnswer }
export { backlog_offer }
