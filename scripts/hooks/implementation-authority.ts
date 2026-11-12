import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_tool_payload } from '#scripts/josh/hook-tool-payload'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { hook_context, type HookContext } from './hook-context'
import { implementation_shell } from './implementation-shell'
import { step_zero_notice } from './step-zero-notice'

const HANDOFF =
	' Implementation refused before execution. Record the plan with issue:plan or issue:comment and hand it to lane:dispatch; repeating the request does not grant authority.'
const UNKNOWN =
	' Cannot verify the write targets of this shell or patch input. Use explicit Edit/Write paths for operational records, or hand implementation to a worker lane.'

const MATCHED = ' Matched rule: '

function edit_refusal(tool_input: unknown): string | undefined {
	return step_zero_notice.edited_paths(tool_input).length === 0 ? 'no edited path' : undefined
}

// The rule an unverified write matched (joshuafolkken/kit#5793), so a false refusal can be diagnosed.
function unverified_write(raw_payload: string): string | undefined {
	const payload = hook_tool_payload.parse(raw_payload)
	if (payload === undefined) return 'an unparsed hook payload'
	if (['apply_patch', 'exec'].includes(payload.tool_name)) return `\`${payload.tool_name}\` input`
	if (['Edit', 'Write'].includes(payload.tool_name)) return edit_refusal(payload.tool_input)
	if (payload.tool_name !== 'Bash') return undefined

	return implementation_shell.refusal(time_shell.bash_command(payload.tool_input))
}

function reason(
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): string | undefined {
	if (agent_session_role.can_implement(context.env)) return undefined

	const scope = agent_session_role.scope_line(context.env)

	if (step_zero_notice.is_runtime_edit(raw_payload, context.cwd, true)) return scope + HANDOFF

	const rule = unverified_write(raw_payload)
	if (rule === undefined) return undefined

	return `${scope}${HANDOFF}${UNKNOWN}${MATCHED}${rule}.`
}

const implementation_authority = { reason }

export { implementation_authority }
