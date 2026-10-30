import { agent_session_role } from '#scripts/agent/agent-session-role'
import { step_zero_notice } from './step-zero-notice'

function reason(raw_payload: string): string | undefined {
	if (agent_session_role.can_implement() || !step_zero_notice.is_runtime_edit(raw_payload)) {
		return undefined
	}

	return agent_session_role.scope_line()
}

const implementation_authority = { reason }

export { implementation_authority }
