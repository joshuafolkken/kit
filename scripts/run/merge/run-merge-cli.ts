import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_baseline } from '#scripts/lane/lane-baseline'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_overrun } from '#scripts/lane/lane-overrun'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_carry, type CarryOwner, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled, type StallCause } from '#scripts/run/park/run-stalled'
import { run_merge, type ChildOutcome } from './run-merge'
import { run_merge_auth } from './run-merge-auth'
import { run_merge_driver } from './run-merge-driver'
import { run_merge_human_review } from './run-merge-human-review'
import { run_merge_signals } from './run-merge-signals'
import { run_merge_steps, type FailedResult, type MergeContext } from './run-merge-steps'
import { run_merge_token, type MergeToken } from './run-merge-token'
import { run_merge_usage_limit } from './run-merge-usage-limit'
import { run_merge_withdrawn, type Collected } from './run-merge-withdrawn'

// `josh run:merge <N>` — one composite command for a `backlogrun` merge event. The parent's context is
// the largest and its per-turn cost the highest, so it calls this once at a child's return and reads
// back the next child number, or a control verdict.
//
// The contract is `run:carry`'s: **standard output carries one token** (or the newline-separated
// offer `epic:next --lanes` prints), and everything else is a captured subprocess or a quiet
// in-process call. The verdicts this command adds to the offer are `over` (hand off),
// `stop` (the consecutive-failure guard tripped, or a failed child could not be parked) and `retry` (the
// child's state could not be read; re-read before deciding).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const FIRST = 0
const MIN_PID = 1
const { MERGE_TOKEN } = run_merge_token
const PARK_FAILURE_NOTE = `The failed child could not be parked with ${RUN_STALLED_LABEL}; stopping.`
// A GitHub `owner/repo` slug: an owner and a repository name around a single slash, each starting with
// an alphanumeric so neither half can begin with `-`. `epic` and `repo` flow into `pnpm josh`
// subprocess arguments, so a value shaped like an option (`--foo`, or `--evil/x`) would be read as a
// flag rather than a value — argument injection (Sonar S8705). The leading-alphanumeric anchor is what
// makes the pattern an *effective* sanitizer: a looser `[\w.-]+` still admits `--evil/x`, which GitHub
// itself forbids (names cannot start with a hyphen) and which the taint analyzer keeps flagging.
const REPO_PATTERN = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u
const USAGE =
	'Usage: josh run:merge <issue> [--over <deprecated>] [--epic <E> --repo <owner/repo>] [--owner <pid>] [--output <path>] [--driver]'

const OPTIONS = {
	driver: { type: 'boolean' },
	epic: { type: 'string' },
	output: { type: 'string' },
	over: { type: 'string' },
	owner: { type: 'string' },
	repo: { type: 'string' },
} as const

interface ParsedArguments {
	positionals: ReadonlyArray<string>
	values: Partial<Record<'epic' | 'output' | 'over' | 'owner' | 'repo', string>> & {
		driver?: boolean
	}
}

// Absent owner is the calling session (`run_carry.session_owner`); a present but malformed pid
// invalidates the invocation rather than silently counting unguarded.
function to_owner(raw: string | undefined): CarryOwner | undefined {
	if (raw === undefined) return run_carry.session_owner()

	// The same count shape `run-carry-args.ts` reads an owner pid under.
	const pid = cli_flags.to_count(raw)

	return pid === undefined || pid < MIN_PID ? undefined : run_carry.owner_of(pid)
}

// The epic form needs a repository (`epic:next --lanes` refuses without one), so an epic named with
// no repository is a usage error rather than a silent fall-through to the backlog offer.
function is_epic_without_repo(values: ParsedArguments['values']): boolean {
	return values.epic !== undefined && values.repo === undefined
}

// Returns a present epic only when it is an issue number, so the string that reaches a subprocess
// argument passes a recognized regex sanitizer in the same expression (Sonar S8705). The named pattern
// is tested directly rather than passed in, because the taint analyzer credits a literal pattern test
// as a sanitizer — exactly as `valid_child` does — but not one reached through a parameter.
function valid_epic(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(raw) ? raw : undefined
}

// The repository counterpart, testing its own named pattern directly for the same reason.
function valid_repo(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return REPO_PATTERN.test(raw) ? raw : undefined
}

// A value that was present but failed its shape check: `valid_epic` / `valid_repo` map it to
// `undefined`, and it was not absent to begin with. An absent value is left to `is_epic_without_repo`
// and the backlog fall-through, so `undefined` is not a rejection.
function is_rejected(raw: string | undefined, valid: string | undefined): boolean {
	return raw !== undefined && valid === undefined
}

// The offer arguments that must hold before a context is built: an epic needs its repository, and
// neither may be shaped like a subprocess flag (`valid_epic` / `valid_repo` reject that). Grouped here
// so `to_context` reads them as one precondition rather than as separate branches.
function has_invalid_offer(values: ParsedArguments['values']): boolean {
	return (
		is_epic_without_repo(values) ||
		is_rejected(values.epic, valid_epic(values.epic)) ||
		is_rejected(values.repo, valid_repo(values.repo))
	)
}

// A caller may still pass a numeric threshold. Its shape remains strict, but its value is ignored so
// a caller cannot introduce a second threshold source.
function has_invalid_legacy_over(raw: string | undefined): boolean {
	if (raw === undefined) return false

	return cli_flags.to_count(raw) === undefined
}

function valid_child(parsed: ParsedArguments): string | undefined {
	const child = parsed.positionals[FIRST]

	if (child === undefined) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(child) ? child : undefined
}

// `backlog:drive` has no context to cut, so its merge is never handed back `over`.
function cut_check_of(values: ParsedArguments['values']): true | undefined {
	return values.driver === true ? undefined : true
}

function to_context(parsed: ParsedArguments): MergeContext | undefined {
	if (has_invalid_offer(parsed.values) || has_invalid_legacy_over(parsed.values.over)) {
		return undefined
	}

	const child = valid_child(parsed)

	if (child === undefined) return undefined

	const owner = to_owner(parsed.values.owner)

	if (owner === undefined) return undefined

	return {
		child,
		epic: valid_epic(parsed.values.epic),
		repo: valid_repo(parsed.values.repo),
		over: cut_check_of(parsed.values),
		owner,
		output: parsed.values.output,
	}
}

function parse(argv: ReadonlyArray<string>): MergeContext | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	return parsed === undefined ? undefined : to_context(parsed)
}

// One handled return: the stdout token and the exit code. Returned rather than printed, so
// `merge_child` carries the verdict to `run_merge_driver.printed`, which prints it.
interface ControlVerdict {
	token: MergeToken
	code: number
	is_offer: false
}

// The next child offered in the collected one's place: the text `backlog:next` or `epic:next --lanes`
// printed, passed through as it was read, so no narrower type holds it. `is_offer` keeps its `stop`
// apart from the control one (`run_merge_token.is_control_stop`).
interface OfferVerdict {
	token: string
	code: number
	is_offer: true
}

type MergeVerdict = ControlVerdict | OfferVerdict

// The verdict together with the outcome it was handled as, which the token alone does not carry — a
// merged, a parked and a failed child all answer with the next offer.
type MergeResult = MergeVerdict & { outcome: ChildOutcome }

function emit(token: MergeToken, code: number): ControlVerdict {
	return { token, code, is_offer: false }
}

// No threshold is `backlog:drive`, which asks `backlog:offer` itself in the pass that collected the
// child: `backlog:next` here would only hold back its next launch (joshuafolkken/kit#4406).
async function offered(ctx: MergeContext): Promise<OfferVerdict> {
	const token =
		ctx.over === undefined ? run_merge_driver.DEFERRED_OFFER : await run_merge_steps.ask_next(ctx)

	return { token, code: SUCCESS_EXIT_CODE, is_offer: true }
}

// A refused count means this session is not the carry record's owner, so the whole operation is
// rejected — the lane is not closed and no next child is offered.
function report_count_refused(carry: RunCarry | undefined): MergeVerdict {
	if (carry !== undefined) console.error(run_carry.count_refused_message(carry))

	return emit(MERGE_TOKEN.BUSY, FAILURE_EXIT_CODE)
}

async function is_on_record(text: string): Promise<boolean> {
	const events = await run_event_stream_emit.invocation_or_all_events()

	return events.some(
		(event) => event.kind === run_event_stream.EVENT_KIND.MERGE && event.text === text,
	)
}

// **Put on record once, dated to the merge's confirmation**: a pass that collects a child already on
// record — `run:carry --end` after `run:merge` — writes neither again.
async function put_merge_on_record(child: string, at: Date): Promise<void> {
	const text = `${issue_cite.plain(child)} merged`

	if (await is_on_record(text)) return

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.MERGE, text, at)
	await lane_ledger_write.record_merge(Number(child), at)
}

// A merged child counted and its lane closed, the merge put on the stream and in the ledger ahead of the
// lane close, dated to the ownership check rather than to the end of the sync (joshuafolkken/kit#4734). Returns the
// carry when the ownership check refused it, `undefined` once recorded. `run:carry --end` records the
// merges a run ended with through it too (`run-merge-collect.ts`). The lane's `ended` record is
// `lane:close`'s alone: an `incomplete` close leaves the lane open on it (joshuafolkken/kit#4300).
async function record_merged(ctx: MergeContext): Promise<RunCarry | undefined> {
	return await run_merge_steps.do_merged(ctx, put_merge_on_record)
}

// A merge is the only outcome that asks the hand-off check, because it is the only one that returned
// the tree to a clean default branch. `over` stops the offer; `under` asks for the next child.
async function on_merged(ctx: MergeContext): Promise<MergeVerdict> {
	const refused = await record_merged(ctx)

	if (refused !== undefined) return report_count_refused(refused)

	await lane_overrun.investigate(Number(ctx.child))
	await lane_baseline.investigate(Number(ctx.child))

	if (await run_merge_steps.is_over_budget(ctx.over)) {
		return emit(MERGE_TOKEN.OVER, SUCCESS_EXIT_CODE)
	}

	return await offered(ctx)
}

// A child released to wait on its open blockers or its start date: settled for this run like a parked
// one, so it goes on the stream the same way, but nothing was counted — the failure guard is not read,
// and the next child is offered.
async function on_waiting(ctx: MergeContext, waits: ReadonlyArray<string>): Promise<MergeVerdict> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.PARK,
		`${issue_cite.plain(ctx.child)} waiting on ${waits.join(', ')}`,
	)

	return await offered(ctx)
}

async function on_parked_failure(ctx: MergeContext, result: FailedResult): Promise<MergeVerdict> {
	if (!result.is_parked) {
		console.error(PARK_FAILURE_NOTE)

		return emit(MERGE_TOKEN.STOP, FAILURE_EXIT_CODE)
	}

	const cause = result.cause ?? run_stalled.SESSION_UNFINISHED.short

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.PARK,
		run_stalled.park_event(ctx.child, cause),
	)

	if (result.carry !== undefined && run_merge.is_guard_tripped(result.carry.failures)) {
		return emit(MERGE_TOKEN.STOP, SUCCESS_EXIT_CODE)
	}

	return await offered(ctx)
}

async function on_failed(ctx: MergeContext, cause?: StallCause): Promise<MergeVerdict> {
	const result = await run_merge_steps.do_failed(ctx, cause)

	if (result.is_refused) return report_count_refused(result.carry)

	if (result.waits.length > 0) return await on_waiting(ctx, result.waits)

	return await on_parked_failure(ctx, result)
}

// An API-outage child: counted into its own streak and left re-dispatchable, not parked. Below the
// outage guard it offers the next child — which may be this same one again; at the guard it emits
// `environment` so the parent stops, the environment being down.
async function on_outage(ctx: MergeContext): Promise<MergeVerdict> {
	const result = await run_merge_steps.do_outage(ctx)

	if (result.is_refused) return report_count_refused(result.carry)

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.OUTAGE,
		`${issue_cite.plain(ctx.child)} outage (re-dispatchable)`,
	)

	if (result.carry !== undefined && run_merge.is_outage_guard_tripped(result.carry.outages)) {
		return emit(MERGE_TOKEN.ENVIRONMENT, SUCCESS_EXIT_CODE)
	}

	return await offered(ctx)
}

// A child whose session could not authenticate: the run stops with nothing counted or parked
// (`run-merge-auth.ts`).
async function on_unauthenticated(ctx: MergeContext): Promise<MergeVerdict> {
	await run_merge_auth.stop(ctx.child)

	return emit(MERGE_TOKEN.ENVIRONMENT, SUCCESS_EXIT_CODE)
}

// A child a usage limit stopped: released uncounted, its reset recorded (`run-merge-usage-limit.ts`).
async function on_usage_limit(ctx: MergeContext): Promise<MergeVerdict> {
	await run_merge_steps.release_child(ctx.child)
	await run_merge_usage_limit.record(ctx.child, ctx.resume_ms ?? Date.now())

	return await offered(ctx)
}

// A child that ended its session with a cut no successor adopted: its successor is relaunched,
// nothing is counted and nothing is parked, and `resumed` tells the parent to await the same lane
// again rather than dispatch into it. A successor that could not be started — or a cut the
// fallback already relaunched once — is the failed child it would otherwise have been. A session that
// does not own the carry record is refused `busy` before anything is relaunched or marked.
async function on_cut(ctx: MergeContext): Promise<MergeVerdict> {
	const refused = await run_merge_steps.refused_carry(ctx)

	if (refused !== undefined) return report_count_refused(refused)

	if (!(await run_merge_steps.resume_cut(ctx.child))) {
		return await on_failed(ctx, run_stalled.CUT_NOT_RELAUNCHED)
	}

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.CHILD_LAUNCH,
		`${issue_cite.plain(ctx.child)} resumed from its cut`,
	)

	return emit(MERGE_TOKEN.RESUMED, SUCCESS_EXIT_CODE)
}

// A child that parked itself: nothing is counted, but the park is written to the stream as a failed
// child's is, so a reader restoring the run from its events sees the child settled. Its `in-progress`
// is dropped as a failed child's is: left on, it would outlive the park label a person later
// lifts, and a `run:solo` child would then hold the whole backlog. A lane it left empty is closed.
async function on_parked(ctx: MergeContext): Promise<MergeVerdict> {
	await run_merge_steps.release_child(ctx.child)
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.PARK,
		`${issue_cite.plain(ctx.child)} parked`,
	)

	return await offered(ctx)
}

// A split child: nothing is counted, and its lane is closed when it holds nothing, so the promoted
// epic does not keep a seat the next child needs.
async function on_skipped(ctx: MergeContext): Promise<MergeVerdict> {
	await run_merge_steps.close_split_lane(ctx.child)
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SPLIT,
		`${issue_cite.plain(ctx.child)} split`,
	)

	return await offered(ctx)
}

// The seat of a child whose lane was collected goes to the next child — or a retry, where the
// withdrawal could not read the child.
async function on_collected(ctx: MergeContext, collected: Collected): Promise<MergeVerdict> {
	if (collected.note !== undefined) console.error(collected.note)
	if (collected.is_retry) return emit(MERGE_TOKEN.RETRY, FAILURE_EXIT_CODE)

	return await offered(ctx)
}

// A child a person withdrew with `lane:withdraw`, or whose issue closed without a merge: nothing is
// counted and no merge is put on record, and its lane is withdrawn unless a person already did
// (`run-merge-withdrawn.ts`).
async function on_withdrawn(ctx: MergeContext): Promise<MergeVerdict> {
	return await on_collected(ctx, await run_merge_withdrawn.collect(ctx.child))
}

// A child that gave its lane back on its `lane:plan` (`lane-yield.ts`): its lane is closed the same way,
// but the issue stays in the run — `backlog:drive` does not exclude a `yielded` child, and its kept
// plan holds it back until the holder ends.
async function on_yielded(ctx: MergeContext): Promise<MergeVerdict> {
	return await on_collected(ctx, await run_merge_withdrawn.collect_yield(ctx.child))
}

// Settle this dispatch without releasing the human-review lane or counting a merge/failure.
async function on_human_review(ctx: MergeContext): Promise<MergeVerdict> {
	if (!(await run_merge_human_review.retain(ctx.child))) {
		return emit(MERGE_TOKEN.RETRY, FAILURE_EXIT_CODE)
	}

	return await offered(ctx)
}

// The state could not be read, which is never `OPEN`: re-read before deciding anything.
async function on_unresolved(): Promise<MergeVerdict> {
	return emit(MERGE_TOKEN.RETRY, FAILURE_EXIT_CODE)
}

async function on_shipping(): Promise<MergeVerdict> {
	return emit(MERGE_TOKEN.RESUMED, SUCCESS_EXIT_CODE)
}

const HANDLERS: Readonly<Record<ChildOutcome, (ctx: MergeContext) => Promise<MergeVerdict>>> = {
	cut: on_cut,
	failed: on_failed,
	'human-review': on_human_review,
	merged: on_merged,
	outage: on_outage,
	unauthenticated: on_unauthenticated,
	'usage-limit': on_usage_limit,
	parked: on_parked,
	split: on_skipped,
	unresolved: on_unresolved,
	shipping: on_shipping,
	withdrawn: on_withdrawn,
	yielded: on_yielded,
}

// The whole merge event for one returned child: read its state, classify it, and run the handler.
// The CLI prints the token and the outcome; `backlog:drive` runs it as a child process
// (`run-merge-driver.ts`) and branches on the printed outcome.
async function merge_child(ctx: MergeContext): Promise<MergeResult> {
	if (lane_handoff.is_ship_running(ctx.child, process.cwd())) {
		return { outcome: 'shipping', ...(await on_shipping()) }
	}

	const read = await issue_state_cli.read_issue(ctx.child, ctx.repo)
	const signals = await run_merge_signals.read_signals(ctx, read)
	const outcome = run_merge_signals.outcome_of(read, signals)

	const { merged_pr, is_streak_exempt, capped_note, resume_ms } = signals
	const handled = { ...ctx, merged_pr, is_streak_exempt, capped_note, resume_ms }

	return { outcome, ...(await HANDLERS[outcome](handled)) }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const ctx = parse(argv)

	if (ctx === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const result = await merge_child(ctx)

	console.info(run_merge_driver.printed(argv, result))

	return result.code
}

const run_merge_cli = {
	merge_child,
	parse,
	read_merged_pr: run_merge_signals.read_merged_pr,
	record_merged,
	run,
}

export type { MergeResult }
export { run_merge_cli }
