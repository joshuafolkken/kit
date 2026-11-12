import path from 'node:path'
import { agent_profile_schema, type AgentProfile } from './agent-profile-schema'
import { agent_session_role } from './agent-session-role'

const AGENT_COMMAND = 'codex'
const AGENT_FLAGS: ReadonlyArray<string> = ['exec']
const MODEL_FLAG = '--model'
const CONFIG_FLAG = '-c'
const JSON_FLAG = '--json'
const SQLITE_CACHE_PATH = ['node_modules', '.cache', 'josh', 'openai']
const EPHEMERAL_FLAG = '--ephemeral'
// Trusted local batches keep action authorization in the workflow and hooks (joshuafolkken/kit#5438).
// This policy cannot remove an OS sandbox inherited from the process that launches the batch.
const PERMISSION_ARGUMENTS: ReadonlyArray<string> = [
	CONFIG_FLAG,
	'default_permissions=":danger-full-access"',
	CONFIG_FLAG,
	'approval_policy="never"',
]

interface CodexArgv {
	command: string
	args: ReadonlyArray<string>
	ends_with_prompt: true
}

function effort_config(profile: AgentProfile): string {
	return `model_reasoning_effort="${profile.effort}"`
}

function role_config(profile: AgentProfile): string {
	return `shell_environment_policy.set.${agent_session_role.KEY}=${JSON.stringify(profile.role)}`
}

function sqlite_config(cwd: string): string {
	return `sqlite_home=${JSON.stringify(path.resolve(cwd, ...SQLITE_CACHE_PATH))}`
}

function persistence_arguments(profile: AgentProfile): ReadonlyArray<string> {
	return profile.role === agent_profile_schema.WORKER ? [] : [EPHEMERAL_FLAG]
}

function lane_arguments(cwd: string | undefined, profile: AgentProfile): ReadonlyArray<string> {
	if (cwd === undefined) return []

	return [CONFIG_FLAG, sqlite_config(cwd), ...persistence_arguments(profile)]
}

function build(invocation: string, profile: AgentProfile, cwd?: string): CodexArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			MODEL_FLAG,
			profile.model,
			CONFIG_FLAG,
			effort_config(profile),
			CONFIG_FLAG,
			role_config(profile),
			...PERMISSION_ARGUMENTS,
			...lane_arguments(cwd, profile),
			JSON_FLAG,
			invocation,
		],
		ends_with_prompt: true,
	}
}

const codex_agent_argv = { build }

export type { CodexArgv }
export { codex_agent_argv }
