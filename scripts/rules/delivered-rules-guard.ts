import { will_refuse as will_batch_refuse } from '#scripts/hooks/batch-guard'
import {
	hook_decision,
	type GuardRun,
	type TranscriptGuard,
	type TranscriptGuardSpec,
} from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import type { DeliveredRule } from './delivered-rules'

// The transcript guard each delivered row runs as (`delivered-rules.ts`). The row reads the cwd and
// environment of the call it judges from the guard's context, never the process's; a `call_only` row
// reads neither.

// The escape hatch, on by default like the other two guards.
const SWITCH_ENV_KEY = 'JOSH_RULE_GUARD'

const STAMP_PREFIX = 'josh-rule-guard-'

// Once per run, so a run that obeyed is never wedged. A call the batching guard may refuse is stepped
// aside from: only one hook's reason surfaces per call, and a stamp written for a lost reason would
// silence the rule for the run. The rule delivers on the reissue instead.
const BATCH_STAMP = hook_decision.create_refusal_stamp(time_batch_guard.STAMP_PREFIX)

// The two hooks race on one event and the stamp is written before the reason, so a record this young
// is the batching guard speaking about the call in hand.
const BATCH_REFUSAL_WINDOW_MS = 10_000

// Asked with its real record, not `NEVER_MS`: that guard never refuses one sequence twice.
function will_batch_guard_refuse(tail: string, call: GuardedCall, run: GuardRun): boolean {
	const refused_at_ms = BATCH_STAMP.last_ms(BATCH_STAMP.path(run.transcript))

	if (run.now_ms - refused_at_ms < BATCH_REFUSAL_WINDOW_MS) return true

	return will_batch_refuse(tail, call, run)
}

function is_first_delivery(
	tail: string,
	call: GuardedCall,
	delivered_at_ms: number,
	run: GuardRun,
): boolean {
	return delivered_at_ms === hook_decision.NEVER_MS && !will_batch_guard_refuse(tail, call, run)
}

// `decide` and `already_satisfied` each replace `is_first_delivery`. A recurring row is always asked;
// the stand-aside reaches it as `can_record`, since what must not happen is recording a refused act.
// An `already_satisfied` row refuses every call until the satisfying act is on the tail.
function delivery_decision(rule: DeliveredRule): TranscriptGuardSpec['should_block'] {
	const { decide, already_satisfied } = rule

	if (decide === undefined && already_satisfied === undefined) return is_first_delivery

	return function should_block(
		tail: string,
		call: GuardedCall,
		delivered_at_ms: number,
		run: GuardRun,
	): boolean {
		if (already_satisfied?.(tail, call, run) === true) return false
		if (decide === undefined) return true

		return decide(call, run, !will_batch_guard_refuse(tail, call, run), delivered_at_ms)
	}
}

type CallTrigger = (call: GuardedCall) => boolean

// A row whose trigger takes its own seam as the second argument, not the call's context, and reads no
// cwd or environment: the row is asked with the call alone, so the seam keeps its default.
function call_only<Row extends { is_trigger: CallTrigger }>(
	row: Row,
): Omit<Row, 'is_trigger'> & { is_trigger: CallTrigger } {
	return { ...row, is_trigger: (call: GuardedCall): boolean => row.is_trigger(call) }
}

function prefix_of(rule_id: string): string {
	return `${STAMP_PREFIX}${rule_id}-`
}

function guard_of(rule: DeliveredRule): TranscriptGuard {
	return hook_decision.create_transcript_guard({
		prefix: prefix_of(rule.id),
		switch_key: SWITCH_ENV_KEY,
		is_candidate: (call, context) => rule.is_trigger(call, context),
		should_block: delivery_decision(rule),
		reason: rule.reason,
	})
}

const delivered_rules_guard = { SWITCH_ENV_KEY, call_only, guard_of, prefix_of }

export { delivered_rules_guard }
