// The JSON envelopes a `PreToolUse` hook answers with, held apart from `hook-decision.ts` (which
// re-exports them under its namespace) because each is a pure function of its arguments.

const HOOK_EVENT_NAME = 'PreToolUse'
const DENY_DECISION = 'deny'
const ALLOW_DECISION = 'allow'

// The documented shape a `PreToolUse` hook answers with. Plain stdout is not it — only this envelope
// stops the call, and only `permissionDecisionReason` reaches the model.
function deny_envelope(reason: string): string {
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: HOOK_EVENT_NAME,
			permissionDecision: DENY_DECISION,
			permissionDecisionReason: reason,
		},
	})
}

// **A rewrite, not a refusal**: the call proceeds with `updated_input` merged
// over its own and is allowed past the permission prompt; a settings `deny` rule still wins over it.
// Where the line may carry commands the hook did not write, `flow_rewrite_envelope` is the one to use.
function rewrite_envelope(updated_input: Record<string, unknown>, context: string): string {
	return JSON.stringify({
		systemMessage: context,
		hookSpecificOutput: {
			hookEventName: HOOK_EVENT_NAME,
			permissionDecision: ALLOW_DECISION,
			updatedInput: updated_input,
			additionalContext: context,
		},
	})
}

// **A rewrite that leaves the permission to the harness.** No `permissionDecision`, so the rewritten
// call meets the same permission flow the typed one would have — whatever else rides the line beside
// the rewritten part is prompted for, or not, exactly as before (joshuafolkken/kit#3875).
function flow_rewrite_envelope(updated_input: Record<string, unknown>, context: string): string {
	return JSON.stringify({
		systemMessage: context,
		hookSpecificOutput: {
			hookEventName: HOOK_EVENT_NAME,
			updatedInput: updated_input,
			additionalContext: context,
		},
	})
}

// **A notice, not a decision.** It carries no `permissionDecision`, so the call proceeds exactly as it
// would have; `additionalContext` is what reaches the model, and `systemMessage` is what the person
// watching sees. Both are filled because either channel alone leaves one of the two blind — and the
// whole point of this envelope is that a guard which cannot look stops being invisible.
function notice_envelope(notice: string): string {
	return JSON.stringify({
		systemMessage: notice,
		hookSpecificOutput: { hookEventName: HOOK_EVENT_NAME, additionalContext: notice },
	})
}

const hook_envelope = { deny_envelope, flow_rewrite_envelope, notice_envelope, rewrite_envelope }

export { hook_envelope }
