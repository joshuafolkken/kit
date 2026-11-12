import { duplicate_read_outcome } from '#scripts/delegation/duplicate-read-guard'
import { investigation_outcome } from '#scripts/delegation/investigation-guard'
import { large_read_outcome } from '#scripts/delegation/large-read-guard'
import { issue_watch_hook } from '#scripts/issue/issue-watch-hook'
import { hook_decision, type GuardOutcome, type TranscriptGuard } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_phase } from '#scripts/lane/lane-phase'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { lane_background } from '#scripts/rules/lane-background'
import { rule_rewrite, type RuleRewrite } from '#scripts/rules/rule-rewrite'
import { run_parent_cut_hook } from '#scripts/run/run-parent-cut-hook'
import { run_poll_hook } from '#scripts/run/run-poll-hook'
import { run_watcher_hook } from '#scripts/run/run-watcher-hook'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_revert } from './bash-revert'
import { batch_outcome } from './batch-guard'
import { direct_gh_usage } from './direct-gh-usage'
import { hook_context, type HookContext } from './hook-context'
import { hook_demoted } from './hook-demoted'
import { hook_ledger } from './hook-ledger'
import { implementation_authority } from './implementation-authority'
import { lane_plan_guard } from './lane-plan-guard'
import { shell_rules_notice } from './shell-rules-notice'
import { step_zero_notice } from './step-zero-notice'

// One PreToolUse process shares the payload schema, deny envelope and `.env` load across all three
// guards (`hook-decision.ts`) without paying a pnpm launch for each guard. Each guard's own
// `refusal` / `outcome` reads the same payload, preserving the individual decisions.
//
// **The verdict is identical to running the three in turn**, and that is the whole point. Each guard
// self-gates on the tool name inside its own `is_candidate` / trigger, so running all three on the
// union matcher (`Bash|Edit|Read|Write|AskUserQuestion|Agent|Task|Glob|Grep|WebFetch`) refuses
// exactly what the three separate entries did — `AskUserQuestion` is matched for the rule guard's
// lane-child interactive-ask row, `Agent|Task` for its `agent-model` row and `Glob|Grep|WebFetch` for
// its `consultation-investigation` row; the investigation guard self-gates away from all of them, and
// the batching guard counts the last three as the bundleable calls they are. A refusal from any
// guard wins first; only when none refuses is a guard's non-blocking notice or fault (the
// whole-file-write notice, a lane child's duplicate-read notice) emitted. Each guard still honours
// its own switch (`JOSH_BATCH_GUARD` / `JOSH_INVESTIGATION_GUARD` / `JOSH_RULE_GUARD`) internally, so this
// process needs no switch of its own.

const CLEAR: GuardOutcome = { reason: undefined, notice: undefined, fault: undefined }
// The name a refusal is recorded under in the hook ledger (`hook-ledger.ts`).
const HOOK_NAME = 'pretool-guard'

function is_clear(outcome: GuardOutcome): boolean {
	return outcome.reason === undefined && outcome.notice === undefined && outcome.fault === undefined
}

// Fold the guards' verdicts into one. A refusal wins over everything else, in the entry order the
// separate hooks had: the outcomes in the order given, then the rule guard's reason. When nothing
// refuses, the first guard that spoke passes its notice or fault through untouched — so a lane child's
// `notice`-mode guidance reaches the model rather than only spending its stamp (joshuafolkken/kit#3877).
// A refusal from a demoted rule yields to any other refusal and otherwise speaks as a notice
// (`hook-demoted.ts`, joshuafolkken/kit#6591).
function combine_outcomes(
	outcomes: ReadonlyArray<GuardOutcome>,
	rule_reason: string | undefined,
	demoted: ReadonlySet<string> = hook_demoted.rules(),
): GuardOutcome {
	const reasons = [...outcomes.map((outcome) => outcome.reason), rule_reason].filter(
		(reason) => reason !== undefined,
	)

	return (
		hook_demoted.verdict(reasons, demoted) ??
		outcomes.find((outcome) => !is_clear(outcome)) ??
		CLEAR
	)
}

// The once-per-session reminders are the last word: asked only where every guard stayed clear, so a
// refusal or another notice never spends their stamps unseen. Step 0 answers an edit and the shell
// rules a Bash call, so at most one of them speaks on a call.
function with_session_notice(
	outcome: GuardOutcome,
	raw_payload: string,
	context: HookContext,
): GuardOutcome {
	if (!is_clear(outcome)) return outcome

	const notice =
		step_zero_notice.notice(raw_payload, context.cwd) ?? shell_rules_notice.notice(raw_payload)

	return notice === undefined ? outcome : { reason: undefined, notice, fault: undefined }
}

function guarded_call(raw_payload: string): GuardedCall | undefined {
	try {
		const payload = hook_decision.parse_hook_payload(raw_payload)

		return payload === undefined
			? undefined
			: { name: payload.tool_name, input: payload.tool_input }
	} catch {
		return undefined
	}
}

function authority_outcome(raw_payload: string, context: HookContext): GuardOutcome {
	return {
		reason: implementation_authority.reason(raw_payload, context),
		notice: undefined,
		fault: undefined,
	}
}

function lane_plan_outcome(raw_payload: string, context: HookContext): GuardOutcome {
	const reason = lane_plan_guard.reason(raw_payload, context.cwd, context.env)

	return { reason, notice: undefined, fault: undefined }
}

// The transcript guards take a clock before the context, so the call is judged at the wall clock.
function clocked(
	outcome: TranscriptGuard['outcome'],
): (raw_payload: string, context: HookContext) => GuardOutcome {
	return function clocked_outcome(raw_payload: string, context: HookContext): GuardOutcome {
		return outcome(raw_payload, Date.now(), context)
	}
}

// The most frequent calls of a session, which only the guards marked `reads` act on.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep'])

// The synchronous guards, in refusal order, and whether each acts on a read-only tool: batching
// and investigation count one, duplicate-read refuses a re-read, large-read a whole large file. The
// edit guards are skipped there by tool name (joshuafolkken/kit#6041) — safe because neither records
// a stamp, and neither fires on a read. The rule rows stay on every call: their
// `consultation-investigation` row is triggered by `Glob` / `Grep`.
const SYNC_GUARDS: ReadonlyArray<{
	outcome: (raw_payload: string, context: HookContext) => GuardOutcome
	reads: boolean
}> = [
	{ outcome: authority_outcome, reads: false },
	{ outcome: clocked(batch_outcome), reads: true },
	{ outcome: clocked(investigation_outcome), reads: true },
	{ outcome: clocked(duplicate_read_outcome), reads: true },
	{ outcome: clocked(large_read_outcome), reads: true },
	{ outcome: lane_plan_outcome, reads: false },
]

// Every guard that acts on the call runs, never short-circuited on the first refusal: each records
// its own once-per-run stamp, so stopping early would change which guard may fire on a later call.
function guard_outcome(raw_payload: string, context: HookContext): GuardOutcome {
	const is_read = READ_ONLY_TOOLS.has(guarded_call(raw_payload)?.name ?? '')
	const outcomes = SYNC_GUARDS.filter((guard) => guard.reads || !is_read).map((guard) =>
		guard.outcome(raw_payload, context),
	)

	return combine_outcomes(
		outcomes,
		delivered_rules.delivery(raw_payload, Date.now(), context),
		hook_demoted.rules(context.env),
	)
}

// The synchronous verdict the Codex adapter asks for, with the session reminders as its last layer.
// The guards read the call's cwd and environment from `context`, never off the process.
function pretool_outcome(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): GuardOutcome {
	return with_session_notice(guard_outcome(raw_payload, context), raw_payload, context)
}

// Both providers mark allowed runtime edits independently of the transcript-keyed Step 0 notice.
// The lane event writer deduplicates them within the child's launch.
async function mark_phase(
	outcome: GuardOutcome,
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	const is_allowed_edit =
		outcome.reason === undefined && step_zero_notice.is_runtime_edit(raw_payload, context.cwd)

	if (is_allowed_edit) await lane_phase.mark_implement(context.cwd, context.env)
}

// The watcher guard is the one composed rule that cannot answer synchronously — it reads the lane
// registry and the watcher's life record off disk. So it is asked after the
// synchronous guards and only where they stayed clear: a refusal from any of them wins first, exactly
// as `combine_outcomes` orders them, and the watcher's refusal fills a clear verdict rather than
// overriding one. It fires once per run itself (`run-watcher-hook.ts`), so a stale watcher refuses the
// first call but not the `pnpm josh run:progress --wait` that fixes it.
//
// **The parent hand-off guard is the second asynchronous rule, asked after the watcher's**.
// It reads the carry record to tell the `backlogrun` parent apart, so it sits
// beside the watcher rather than among the synchronous rows; a stale watcher is the cheaper fix and is
// surfaced first. **The poll guard is third**: it reads the same carry record, and only for a call that
// repeats a state read, so the hand-off still wins over it.
async function async_reason(
	raw_payload: string,
	context: HookContext,
): Promise<string | undefined> {
	const watcher = await run_watcher_hook.watcher_hook_reason(raw_payload, context)
	const state = run_parent_cut_hook.current_state(context)
	const cut =
		watcher ?? (await run_parent_cut_hook.parent_cut_reason(raw_payload, Date.now(), state))
	const poll = cut ?? (await run_poll_hook.safe_poll_reason(raw_payload, context))

	return poll ?? (await issue_watch_hook.watch_reason(context))
}

async function pretool_outcome_async(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): Promise<GuardOutcome> {
	const base = guard_outcome(raw_payload, context)

	if (base.reason !== undefined) return base

	const reason = await async_reason(raw_payload, context)

	if (reason !== undefined) return { reason, notice: undefined, fault: undefined }

	const outcome = with_session_notice(base, raw_payload, context)

	await mark_phase(outcome, raw_payload, context)

	return outcome
}

// A rewrite's note first, so the transcript's context line opens with it; the outcome's notice after.
function rewrite_context(note: string, outcome: GuardOutcome): string {
	return [note, outcome.notice ?? outcome.fault].filter(Boolean).join('\n\n')
}

function foreground_input_of(
	raw_payload: string,
	is_lane_child: () => boolean,
): Record<string, unknown> | undefined {
	const call = guarded_call(raw_payload)

	return call === undefined ? undefined : lane_background.foreground_input(call, is_lane_child)
}

// The envelope that replaces the outcome's own when a lane child runs `josh ship` alone: the call is
// run in the foreground at the cap instead of being refused or moved aside. A refusal from any guard
// still wins, and a notice the outcome carried rides along in the same context. On top of a row's
// rewrite — `raw_payload` is then the rewritten call — it keeps that row's notes and its lack of a
// permission decision, so the cap is never lost to a pipefail or tail rewrite (joshuafolkken/kit#4101).
function foreground_rewrite(
	outcome: GuardOutcome,
	raw_payload: string,
	is_lane_child: () => boolean,
	rewrite?: RuleRewrite,
): string | undefined {
	const input =
		outcome.reason === undefined ? foreground_input_of(raw_payload, is_lane_child) : undefined

	if (input === undefined) return undefined

	const note = [rewrite?.note, lane_background.FOREGROUND_NOTE].filter(Boolean).join('\n\n')
	const envelope_of =
		rewrite === undefined ? hook_decision.rewrite_envelope : hook_decision.flow_rewrite_envelope

	return envelope_of(input, rewrite_context(note, outcome))
}

// The rows' rewrite carries no permission decision: whatever else the line runs meets its own prompt.
function rule_envelope(
	outcome: GuardOutcome,
	rewrite: RuleRewrite | undefined,
): string | undefined {
	if (rewrite === undefined || outcome.reason !== undefined) return undefined

	return hook_decision.flow_rewrite_envelope(rewrite.input, rewrite_context(rewrite.note, outcome))
}

// The hook's one write: a rewrite where one applies, the outcome's own envelope otherwise.
function emit(
	raw_payload: string,
	outcome: GuardOutcome,
	rewrite?: RuleRewrite,
	context: HookContext = hook_context.from_process(),
): void {
	const is_lane_child = lane_child_marker.is_child_of.bind(undefined, context.cwd, context.env)
	const envelope =
		foreground_rewrite(outcome, raw_payload, is_lane_child, rewrite) ??
		rule_envelope(outcome, rewrite)

	if (envelope === undefined) hook_decision.emit_outcome(outcome)
	else process.stdout.write(`${envelope}\n`)
}

// The ledger line for a judged call — written by both harnesses' entries, after their verdict. An
// allowed call also counts the `gh` it launches (`direct-gh-usage.ts`); a refused one never runs. A
// demoted rule's notice is recorded as the refusal it stood for, though its call runs.
async function record_refusal(
	judged_payload: string,
	outcome: GuardOutcome,
	context: HookContext = hook_context.from_process(),
	demoted: ReadonlySet<string> = hook_demoted.rules(context.env),
): Promise<void> {
	const refusal = outcome.reason ?? hook_demoted.refusal_of(outcome.notice, demoted)

	await hook_ledger.record_reason(HOOK_NAME, refusal, judged_payload, context)

	if (outcome.reason === undefined) await direct_gh_usage.record(judged_payload, context)
}

// **The guards judge the call that will run.** A rewritten call reaches every guard already made
// right, so the rewriting row stays quiet on it while any other guard's refusal still wins over the
// rewrite. The Codex adapter cannot rewrite a call, so it goes on judging the call as typed.
// A consultation session's shell is stamped here for the `PostToolUse` revert (`bash-revert.ts`).
async function respond(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	const rewrite = rule_rewrite.rewrite(raw_payload, context)
	const judged = rewrite?.payload ?? raw_payload

	bash_revert.stamp(judged, context.cwd)
	const outcome = await pretool_outcome_async(judged, context)

	emit(judged, outcome, rewrite, context)
	await record_refusal(judged, outcome, context)
}

const pretool_guard = {
	combine_outcomes,
	emit,
	foreground_rewrite,
	mark_phase,
	pretool_outcome,
	record_refusal,
	respond,
}

export { pretool_guard, pretool_outcome, pretool_outcome_async }
