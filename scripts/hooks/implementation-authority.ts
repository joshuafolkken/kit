import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_decision } from '#scripts/josh/hook-decision'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { implementation_shell } from './implementation-shell'
import { step_zero_notice } from './step-zero-notice'

const HANDOFF =
	' Implementation refused before execution. Record the plan with issue:plan or issue:comment and hand it to lane:dispatch; repeating the request does not grant authority.'
const UNKNOWN =
	' Cannot verify the write targets of this shell or patch input. Use explicit Edit/Write paths for operational records, or hand implementation to a worker lane.'

function is_unverified_write(raw_payload: string): boolean {
	const payload = hook_decision.parse_hook_payload(raw_payload)
	if (payload === undefined || ['apply_patch', 'exec'].includes(payload.tool_name)) return true

	if (['Edit', 'Write'].includes(payload.tool_name)) {
		return step_zero_notice.edited_paths(payload.tool_input).length === 0
	}

	return (
		payload.tool_name === 'Bash' &&
		implementation_shell.is_unsafe(time_shell.bash_command(payload.tool_input))
	)
}

function reason(raw_payload: string): string | undefined {
	if (agent_session_role.can_implement()) return undefined

	if (step_zero_notice.is_runtime_edit(raw_payload, process.cwd(), true)) {
		return agent_session_role.scope_line() + HANDOFF
	}

	if (is_unverified_write(raw_payload)) return agent_session_role.scope_line() + HANDOFF + UNKNOWN

	return undefined
}

const implementation_authority = { reason }

export { implementation_authority }
