import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { lane_guard_policy } from '#scripts/lane/lane-guard-policy'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { investigation_reads } from './investigation-reads'

// The disk half of the investigation-delegation threshold: find the
// transcript, read enough of its end, count the files read and not edited since the last delegated
// unit, and refuse the read that takes that count up to the threshold.
//
// **It is a `PreToolUse` hook because the rule it enforces fails as prose**: a run that asks the
// question once reads on without asking again. The counting is
// `investigation-reads.ts`, and the shell — the six steps every refusing hook takes, every one of
// which allows the call when it fails — is `hook-decision.ts`, shared with `batch-guard.ts`.

// The escape hatch, **on by default** for the reason `JOSH_BATCH_GUARD` is: this is a distributed
// convention rather than an opt-in measurement, and a guard nobody enables leaves the Issue where it
// started. What the variable buys is a way to switch a refusing hook off without editing the settings
// file — debugging the guard itself, or a session whose reading really is all edit targets.
const SWITCH_ENV_KEY = 'JOSH_INVESTIGATION_GUARD'

const STAMP_PREFIX = 'josh-investigation-guard-'

// **How the guard behaves for the session in hand, decided from the one-place enumeration**. It is
// `refuse` in a dispatched lane child too (joshuafolkken/kit#3927): a hook denial returns to the model
// as guidance, and the notice it replaced was measured not to move the reading. It wraps
// `investigation_reads.should_block` here rather than inside it so the counting rule stays free of the
// session's switch state and its own suite keeps testing it directly — its only process read is the
// branch diff it asks before a refusal. A reviewer session stands down: reading
// the diff's files is its whole task, and it carries the lane's marker, so it would otherwise be refused
// like the child it reviews — the stand-down `implementation-cut.ts` takes for the same session.
function should_block(
	tail: string,
	call: GuardedCall,
	refused_at_ms: number,
	run?: GuardRun,
): boolean {
	if (
		agent_session_role.is_reviewer() ||
		lane_guard_policy.mode_here('investigation') !== 'refuse'
	) {
		return false
	}

	return investigation_reads.should_block(tail, call, refused_at_ms, run)
}

const GUARD = hook_decision.create_transcript_guard({
	prefix: STAMP_PREFIX,
	switch_key: SWITCH_ENV_KEY,
	is_candidate: investigation_reads.is_refusable_call,
	should_block,
	reason: investigation_reads.REASON,
})

const investigation_refusal = GUARD.refusal
const investigation_outcome = GUARD.outcome
const { is_enabled, refusal_path } = GUARD
const { deny_envelope, load_environment_file, DISABLED_VALUES } = hook_decision

export {
	deny_envelope,
	investigation_outcome,
	investigation_refusal,
	is_enabled,
	load_environment_file,
	refusal_path,
	DISABLED_VALUES,
	SWITCH_ENV_KEY,
}
