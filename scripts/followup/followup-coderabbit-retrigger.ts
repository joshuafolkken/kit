// cspell:words coderabbit coderabbitai
import { is_coderabbit_author, is_coderabbit_rate_limit } from '#scripts/gh/git-ai-review-scan'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { SnapshotObserver } from '#scripts/gh/git-pr-checks'
import { parse_pr_state_snapshot } from '#scripts/gh/git-pr-checks-parse'
import { ai_review_pull_comment_schema } from '#scripts/git/git-schemas'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { poll } from '#scripts/lib/poll'
import type { CodeRabbitState } from '#scripts/run/event/run-event-checks'
import { followup_checks_event } from './followup-checks-event'
import { followup_coderabbit_wait, type CodeRabbitWait } from './followup-coderabbit-wait'

// A rate-limited CodeRabbit, retriggered once by `followup` itself (joshuafolkken/kit#5289): read the
// window off CodeRabbit's own notice, wait it out, post `@coderabbitai review`, and wait for the check
// again. **Once per pull request** — a retrigger comment older than the latest notice means the one
// attempt was spent, and a second rate limit is the person's call (bypassing it is Tier C); one newer
// than it, whoever posted it, is a review still to come and is waited for, not posted again. The pull
// request, not the ledger, answers "already retriggered", so a re-run `followup` reads the same answer.

const RETRIGGER_BODY = '@coderabbitai review'
// CodeRabbit's own notice supplies the wait, so the window follows the service's rate limit.
const WAIT_OPENER = /please wait/iu
const WAIT_CLOSER = /before/iu
const TOKEN = /\d+|[a-z]+/giu
const DIGITS = /^\d+$/u
const SECOND_MS = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const MINUTE_MS = SECONDS_PER_MINUTE * SECOND_MS
const UNIT_MS: Readonly<Record<string, number>> = {
	h: MINUTES_PER_HOUR * MINUTE_MS,
	m: MINUTE_MS,
	s: SECOND_MS,
}
// Past the window's end, so the retrigger does not land on its last second.
const MARGIN_SECONDS = 15
const MARGIN_MS = MARGIN_SECONDS * SECOND_MS
// The longest window `followup` waits out; a longer one is left to the person (`followup.md`).
const WINDOW_CAP_MINUTES = 30
const WINDOW_CAP_MS = WINDOW_CAP_MINUTES * MINUTE_MS
// The wait for the retriggered review: twenty minutes, polled every thirty seconds.
const REVIEW_WAIT_ATTEMPTS = 40
const REVIEW_WAIT_INTERVAL_SECONDS = 30
const REVIEW_WAIT_INTERVAL_MS = REVIEW_WAIT_INTERVAL_SECONDS * SECOND_MS
const NO_TIME = 0
const FIRST = 0
const NEXT = 1
const RATE_LIMITED: CodeRabbitState = 'rate-limited'
const TIER_C = 'bypassing it is Tier C — explicit user instruction only'
const BY_HAND = `wait it out, post \`${RETRIGGER_BODY}\` and rerun followup; ${TIER_C}`
const AGAIN_NOTE = `CodeRabbit rate-limited again after the one \`${RETRIGGER_BODY}\` (kit#5289): ${TIER_C}`
const UNREADABLE_NOTE = `CodeRabbit rate-limited with no window readable from its comments (kit#5289): no retrigger posted — ${BY_HAND}`
const UNFINISHED_NOTE = `CodeRabbit still reviewing after \`${RETRIGGER_BODY}\` (kit#5289): the merge goes ahead without it`

interface PullComment {
	body?: string | undefined
	author?: { login?: string | undefined } | undefined
	updatedAt?: string | undefined
}

type Decision =
	{ kind: 'retrigger'; wait_ms: number } | { kind: 'await' } | { kind: 'stop'; note: string }

interface Retrigger {
	is_retriggered: boolean
	notes: Array<string>
}

interface Settled<T> {
	snapshot: T
	is_retriggered: boolean
	notes: Array<string>
}

function wait_clause_of(body: string): string {
	const after_opener = body.split(WAIT_OPENER)[NEXT] ?? ''

	return after_opener.split(WAIT_CLOSER)[FIRST] ?? ''
}

// The time one token stands for: a number times the unit the next token starts with.
function token_ms(tokens: ReadonlyArray<string>, index: number): number {
	const token = tokens[index] ?? ''
	if (!DIGITS.test(token)) return NO_TIME
	const unit = (tokens[index + NEXT] ?? '').charAt(FIRST).toLowerCase()

	return Number(token) * (UNIT_MS[unit] ?? NO_TIME)
}

// The wait CodeRabbit's notice states, or `undefined` for a comment that states none.
function parse_wait_ms(body: string): number | undefined {
	if (!is_coderabbit_rate_limit(body)) return undefined
	const tokens = wait_clause_of(body).match(TOKEN) ?? []
	const wait_ms = tokens.reduce((sum, _token, index) => sum + token_ms(tokens, index), NO_TIME)

	return wait_ms === NO_TIME ? undefined : wait_ms
}

function is_notice(comment: PullComment): boolean {
	return (
		is_coderabbit_author(comment.author?.login ?? '') &&
		is_coderabbit_rate_limit(comment.body ?? '')
	)
}

function is_retrigger(comment: PullComment): boolean {
	return comment.body?.trim() === RETRIGGER_BODY
}

function written_ms(comment: PullComment): number {
	return Date.parse(comment.updatedAt ?? '')
}

// The latest time among the comments `is_match` picks; one with no readable time counts as none.
function latest_ms(
	comments: ReadonlyArray<PullComment>,
	is_match: (comment: PullComment) => boolean,
): number | undefined {
	const times = comments
		.filter((comment) => is_match(comment))
		.map((comment) => written_ms(comment))
		.filter((ms) => !Number.isNaN(ms))

	return times.length === 0 ? undefined : Math.max(...times)
}

// The latest end any CodeRabbit notice states — the window counts from when the notice was written.
function window_end_ms(comments: ReadonlyArray<PullComment>): number | undefined {
	const ends = comments
		.filter((comment) => is_notice(comment))
		.map((comment) => written_ms(comment) + (parse_wait_ms(comment.body ?? '') ?? NaN))
		.filter((ms) => !Number.isNaN(ms))

	return ends.length === 0 ? undefined : Math.max(...ends)
}

// A retrigger written after the latest notice is still to be answered; one before it was answered
// with another rate limit. Either time unreadable reads as the second.
function decide_after_retrigger(comments: ReadonlyArray<PullComment>): Decision {
	const retrigger_ms = latest_ms(comments, is_retrigger) ?? NO_TIME
	const notice_ms = latest_ms(comments, is_notice) ?? retrigger_ms

	return retrigger_ms > notice_ms ? { kind: 'await' } : { kind: 'stop', note: AGAIN_NOTE }
}

function too_long_note(wait_ms: number): string {
	const minutes = String(Math.ceil(wait_ms / MINUTE_MS))

	return `CodeRabbit rate-limited for ${minutes} more minutes, over followup's ${String(WINDOW_CAP_MINUTES)} minute wait (kit#5289): no retrigger posted — ${BY_HAND}`
}

function decide(comments: ReadonlyArray<PullComment>, now_ms: number): Decision {
	if (comments.some((comment) => is_retrigger(comment))) return decide_after_retrigger(comments)
	const end_ms = window_end_ms(comments)
	if (end_ms === undefined) return { kind: 'stop', note: UNREADABLE_NOTE }
	const wait_ms = Math.max(NO_TIME, end_ms - now_ms) + MARGIN_MS

	return wait_ms > WINDOW_CAP_MS
		? { kind: 'stop', note: too_long_note(wait_ms) }
		: { kind: 'retrigger', wait_ms }
}

async function read_comments(branch_name: string): Promise<Array<PullComment>> {
	const raw = await git_gh_command.pr_get_comments(branch_name)

	return parse_json_array_or_undefined(raw ?? '', ai_review_pull_comment_schema) ?? []
}

async function read_state(
	branch_name: string,
	observe: SnapshotObserver,
): Promise<CodeRabbitState> {
	const checks = await git_gh_command.pr_get_checks_snapshot(branch_name)
	const snapshot = parse_pr_state_snapshot(checks.snapshot_json)

	await observe(snapshot)

	return followup_checks_event.coderabbit_of(snapshot)
}

// **A rate limit read before the review started is the old one**, so only one read after another
// state is the second rate limit; a check that never moves off it is read as one at the budget's end.
// One observer for the whole wait, so its polls are timed against one another.
async function wait_for_review(branch_name: string, wait: CodeRabbitWait): Promise<Array<string>> {
	const observe = followup_coderabbit_wait.observer_of(wait)
	let is_started = false
	let state: CodeRabbitState = RATE_LIMITED
	const is_settled = await poll.poll_until(
		async () => {
			state = await read_state(branch_name, observe)
			is_started ||= state !== RATE_LIMITED

			return is_started && state !== 'running'
		},
		{ attempts: REVIEW_WAIT_ATTEMPTS, interval_ms: REVIEW_WAIT_INTERVAL_MS, sleeper: poll.sleep },
	)
	if (state === RATE_LIMITED) return [AGAIN_NOTE]

	return is_settled ? [] : [UNFINISHED_NOTE]
}

async function retrigger(
	branch_name: string,
	wait: CodeRabbitWait,
	wait_ms: number,
): Promise<Retrigger> {
	const seconds = String(Math.ceil(wait_ms / SECOND_MS))

	console.info(`⏳ CodeRabbit rate-limited — waiting ${seconds}s, then \`${RETRIGGER_BODY}\``)
	await poll.sleep(wait_ms)
	await git_gh_command.pr_comment(branch_name, RETRIGGER_BODY)
	await lane_ledger_write.record_stage({
		stage: lane_ledger_write.CODERABBIT_RETRIGGER_STAGE,
		elapsed_ms: wait_ms,
	})

	return { is_retriggered: true, notes: await wait_for_review(branch_name, wait) }
}

// Runs only when the check wait last saw CodeRabbit rate-limited; anything else is untouched.
async function run(branch_name: string, wait: CodeRabbitWait): Promise<Retrigger> {
	if (wait.last?.state !== RATE_LIMITED) return { is_retriggered: false, notes: [] }
	const decision = decide(await read_comments(branch_name), Date.now())
	if (decision.kind === 'stop') return { is_retriggered: false, notes: [decision.note] }

	if (decision.kind === 'await') {
		return { is_retriggered: true, notes: await wait_for_review(branch_name, wait) }
	}

	return await retrigger(branch_name, wait, decision.wait_ms)
}

// The checks after a retriggered review are read again, so the merge and the skip notes read the
// snapshot that review left, not the rate-limited one.
async function settle<T>(
	snapshot: T,
	wait_for_green: () => Promise<T>,
	branch_name: string,
	wait: CodeRabbitWait,
): Promise<Settled<T>> {
	const { is_retriggered, notes } = await run(branch_name, wait)
	if (!is_retriggered) return { snapshot, is_retriggered, notes }

	return { snapshot: await wait_for_green(), is_retriggered, notes }
}

const followup_coderabbit_retrigger = {
	AGAIN_NOTE,
	RETRIGGER_BODY,
	UNFINISHED_NOTE,
	UNREADABLE_NOTE,
	decide,
	parse_wait_ms,
	run,
	settle,
}

export type { PullComment, Retrigger, Settled }
export { followup_coderabbit_retrigger }
