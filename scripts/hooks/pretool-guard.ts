#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { duplicate_read_outcome } from '#scripts/delegation/duplicate-read-guard'
import { investigation_refusal } from '#scripts/delegation/investigation-guard'
import { hook_decision, type GuardOutcome } from '#scripts/josh/hook-decision'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { batch_outcome } from './batch-guard'

// One PreToolUse process for the three guards that used to be three (joshuafolkken/kit#1930). A Bash
// call used to spawn `batch:guard`, `investigation:guard` and `rule:guard` separately — three pnpm
// launches on top of the tool call — while consumers paid that thrice on every guarded call. The
// three share one shell (`hook-decision.ts`): the same payload schema, the same deny envelope, the
// same `.env` load. So the consolidation is a composition, not a rewrite — each guard's own
// `refusal` / `outcome` is called, unchanged, on the one payload this process reads.
//
// **The verdict is identical to running the three in turn**, and that is the whole point. Each guard
// self-gates on the tool name inside its own `is_candidate` / trigger, so running all three on the
// union matcher (`Bash|Edit|Read|Write|AskUserQuestion`) refuses exactly what the three separate
// entries did — `AskUserQuestion` is matched for the rule guard's lane-child interactive-ask row
// (joshuafolkken/kit#2201), and the batching and investigation guards self-gate away from it. A
// refusal from any guard wins first; only when none refuses is the batch guard's non-blocking notice
// (the whole-file-write notice, joshuafolkken/kit#1848) emitted. Each guard still honours its own
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
// non-refusal notice (joshuafolkken/kit#2298). Its notice is surfaced only where nothing else spoke —
// a refusal from any guard, or the batch guard's own notice, wins first.
function with_duplicate_notice(combined: GuardOutcome, notice: string | undefined): GuardOutcome {
	if (notice === undefined || !is_clear(combined)) return combined

	return { reason: undefined, notice, fault: undefined }
}

// All guards run unconditionally, exactly as the separate PreToolUse entries did: each records its own
// once-per-run stamp, so short-circuiting on the first refusal would change which guard is allowed to
// fire on a later call.
function pretool_outcome(raw_payload: string): GuardOutcome {
	const batch = batch_outcome(raw_payload)
	const investigation = investigation_refusal(raw_payload)
	const duplicate = duplicate_read_outcome(raw_payload)
	const rule = delivered_rules.delivery(raw_payload)
	const duplicate_refusal = duplicate.reason
	const combined = combine_outcomes(batch, investigation ?? duplicate_refusal ?? rule)

	return with_duplicate_notice(combined, duplicate.notice)
}

const pretool_guard = { combine_outcomes, pretool_outcome }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('pretool:guard')
	else hook_decision.write_outcome(await text(process.stdin), pretool_outcome)
}

export { pretool_guard, pretool_outcome }
