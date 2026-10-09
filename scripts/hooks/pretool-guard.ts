import { duplicate_read_outcome } from '#scripts/delegation/duplicate-read-guard'
import { investigation_refusal } from '#scripts/delegation/investigation-guard'
import { hook_decision, type GuardOutcome } from '#scripts/josh/hook-decision'
import { lane_phase } from '#scripts/lane/lane-phase'
import { json_value } from '#scripts/lib/json-value'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { lane_background } from '#scripts/rules/lane-background'
import { piped_verification } from '#scripts/rules/piped-verification'
import { run_parent_cut_hook } from '#scripts/run/run-parent-cut-hook'
import { run_watcher_hook } from '#scripts/run/run-watcher-hook'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { batch_outcome } from './batch-guard'
import { step_zero_notice } from './step-zero-notice'

// One PreToolUse process for the three guards that used to be three. A Bash
// call used to spawn `batch:guard`, `investigation:guard` and `rule:guard` separately — three pnpm
// launches on top of the tool call — while consumers paid that thrice on every guarded call. The
// three share one shell (`hook-decision.ts`): the same payload schema, the same deny envelope, the
// same `.env` load. So the consolidation is a composition, not a rewrite — each guard's own
// `refusal` / `outcome` is called, unchanged, on the one payload this process reads.
//
// **The verdict is identical to running the three in turn**, and that is the whole point. Each guard
// self-gates on the tool name inside its own `is_candidate` / trigger, so running all three on the
// union matcher (`Bash|Edit|Read|Write|AskUserQuestion`) refuses exactly what the three separate
// entries did — `AskUserQuestion` is matched for the rule guard's lane-child interactive-ask row,
// and the batching and investigation guards self-gate away from it. A
// refusal from any guard wins first; only when none refuses is the batch guard's non-blocking notice
// (the whole-file-write notice) emitted. Each guard still honours its own
// switch (`JOSH_BATCH_GUARD` / `JOSH_INVESTIGATION_GUARD` / `JOSH_RULE_GUARD`) internally, so this
// process needs no switch of its own.

// Fold the guards' verdicts into one. A refusal wins over everything else, and the batch guard's
// reason is shown first to match the entry order the separate hooks had. When nothing refuses,
// whatever the batch guard reported (a notice, a fault, or nothing) passes through untouched.
function combine_outcomes(batch: GuardOutcome, extra_reason: string | undefined): GuardOutcome {
	if (batch.reason !== undefined) return batch

	if (extra_reason !== undefined) {
		return { reason: extra_reason, notice: undefined, fault: undefined }
	}

	return batch
}

function is_clear(outcome: GuardOutcome): boolean {
	return outcome.reason === undefined && outcome.notice === undefined && outcome.fault === undefined
}

// The duplicate-read guard is `notice`-mode in a lane child, so it is the second guard that can raise a
// non-refusal notice. Its notice is surfaced only where nothing else spoke —
// a refusal from any guard, or the batch guard's own notice, wins first.
function with_duplicate_notice(combined: GuardOutcome, notice: string | undefined): GuardOutcome {
	if (notice === undefined || !is_clear(combined)) return combined

	return { reason: undefined, notice, fault: undefined }
}

// The Step 0 reminder is the last word: asked only where every guard stayed
// clear, so a refusal or another notice never spends its once-per-session stamp unseen.
function with_step_zero_notice(outcome: GuardOutcome, raw_payload: string): GuardOutcome {
	if (!is_clear(outcome)) return outcome

	const notice = step_zero_notice.notice(raw_payload)

	return notice === undefined ? outcome : { reason: undefined, notice, fault: undefined }
}

// All guards run unconditionally, exactly as the separate PreToolUse entries did: each records its own
// once-per-run stamp, so short-circuiting on the first refusal would change which guard is allowed to
// fire on a later call.
function guard_outcome(raw_payload: string): GuardOutcome {
	const batch = batch_outcome(raw_payload)
	const investigation = investigation_refusal(raw_payload)
	const duplicate = duplicate_read_outcome(raw_payload)
	const rule = delivered_rules.delivery(raw_payload)
	const duplicate_refusal = duplicate.reason
	const combined = combine_outcomes(batch, investigation ?? duplicate_refusal ?? rule)

	return with_duplicate_notice(combined, duplicate.notice)
}

// The synchronous verdict the Codex adapter asks for, with the Step 0 reminder as its last layer.
function pretool_outcome(raw_payload: string): GuardOutcome {
	return with_step_zero_notice(guard_outcome(raw_payload), raw_payload)
}

// The Step 0 notice fires once, on the first runtime-file edit: the moment a lane child's plan turns
// into code, which `run:board` draws as its `implement` phase. Both the Claude
// path and the Codex adapter call this on their final outcome, so neither runtime skips the phase.
async function mark_phase(outcome: GuardOutcome): Promise<void> {
	if (outcome.notice === step_zero_notice.NOTICE) await lane_phase.mark_implement()
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
// surfaced first.
async function async_reason(raw_payload: string): Promise<string | undefined> {
	const watcher = await run_watcher_hook.watcher_hook_reason(raw_payload)

	return watcher ?? (await run_parent_cut_hook.parent_cut_reason(raw_payload))
}

async function pretool_outcome_async(raw_payload: string): Promise<GuardOutcome> {
	const base = guard_outcome(raw_payload)

	if (!is_clear(base)) return base

	const reason = await async_reason(raw_payload)

	if (reason !== undefined) return { reason, notice: undefined, fault: undefined }

	const outcome = with_step_zero_notice(base, raw_payload)

	await mark_phase(outcome)

	return outcome
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

// A rewrite's note first, so the transcript's context line opens with it; the outcome's notice after.
function rewrite_context(note: string, outcome: GuardOutcome): string {
	return [note, outcome.notice ?? outcome.fault].filter(Boolean).join('\n\n')
}

// The envelope that replaces the outcome's own when a lane child backgrounded `josh ship` alone:
// the call is run in the foreground instead of being refused. A refusal from
// any guard still wins, and a notice the outcome carried rides along in the same context.
function foreground_rewrite(
	outcome: GuardOutcome,
	raw_payload: string,
	is_lane_child?: () => boolean,
): string | undefined {
	if (outcome.reason !== undefined) return undefined

	const call = guarded_call(raw_payload)
	const input =
		call === undefined ? undefined : lane_background.foreground_input(call, is_lane_child)

	if (input === undefined) return undefined

	return hook_decision.rewrite_envelope(
		input,
		rewrite_context(lane_background.FOREGROUND_NOTE, outcome),
	)
}

interface PipefailRewrite {
	payload: string
	input: Record<string, unknown>
}

// A piped josh check the hook runs under `set -o pipefail` instead of refusing it:
// the rewritten input, and the payload that carries it. The rewrite is the
// rule guard's delivery, so the rule guard's switch turns it off too.
function pipefail_rewrite(raw_payload: string): PipefailRewrite | undefined {
	if (!delivered_rules.is_enabled()) return undefined

	const call = guarded_call(raw_payload)
	const input = call === undefined ? undefined : piped_verification.pipefail_input(call)
	const payload = json_value.parse_or_undefined(raw_payload)

	if (input === undefined || !json_value.is_record(payload)) return undefined

	return { payload: JSON.stringify({ ...payload, tool_input: input }), input }
}

function pipefail_envelope(
	outcome: GuardOutcome,
	input: Record<string, unknown> | undefined,
): string | undefined {
	if (input === undefined || outcome.reason !== undefined) return undefined

	return hook_decision.rewrite_envelope(
		input,
		rewrite_context(piped_verification.PIPEFAIL_NOTE, outcome),
	)
}

// The hook's one write: a rewrite where one applies, the outcome's own envelope otherwise.
function emit(
	raw_payload: string,
	outcome: GuardOutcome,
	pipefail_input?: Record<string, unknown>,
): void {
	const rewrite =
		pipefail_envelope(outcome, pipefail_input) ?? foreground_rewrite(outcome, raw_payload)

	if (rewrite === undefined) hook_decision.emit_outcome(outcome)
	else process.stdout.write(`${rewrite}\n`)
}

// **The guards judge the call that will run.** A rewritable piped check reaches every guard already
// prefixed, so the piped-verification row stays quiet on it while any other guard's refusal still wins
// over the rewrite. The Codex adapter cannot rewrite a call, so it goes on judging the call as typed.
async function respond(raw_payload: string): Promise<void> {
	const pipefail = pipefail_rewrite(raw_payload)
	const judged = pipefail?.payload ?? raw_payload

	emit(judged, await pretool_outcome_async(judged), pipefail?.input)
}

const pretool_guard = {
	combine_outcomes,
	emit,
	foreground_rewrite,
	mark_phase,
	pipefail_rewrite,
	pretool_outcome,
	respond,
}

export { pretool_guard, pretool_outcome, pretool_outcome_async }
