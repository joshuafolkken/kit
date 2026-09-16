import path from 'node:path'
import type { AgentProfile } from './agent-role-profile'

const AGENT_COMMAND = 'codex'
const AGENT_FLAGS: ReadonlyArray<string> = ['exec', '--sandbox', 'workspace-write']
const MODEL_FLAG = '--model'
const CONFIG_FLAG = '-c'
const JSON_FLAG = '--json'
const NETWORK_CONFIG = 'sandbox_workspace_write.network_access=true'
const SQLITE_CACHE_PATH = ['node_modules', '.cache', 'josh', 'openai']
const EPHEMERAL_FLAG = '--ephemeral'

interface CodexArgv {
	command: string
	args: ReadonlyArray<string>
}

function effort_config(profile: AgentProfile): string {
	return `model_reasoning_effort="${profile.effort}"`
}

function sqlite_config(cwd: string): string {
	return `sqlite_home=${JSON.stringify(path.resolve(cwd, ...SQLITE_CACHE_PATH))}`
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
			NETWORK_CONFIG,
			...(cwd === undefined ? [] : [CONFIG_FLAG, sqlite_config(cwd), EPHEMERAL_FLAG]),
			JSON_FLAG,
			invocation,
		],
	}
}

const codex_agent_argv = { AGENT_COMMAND, AGENT_FLAGS, build }

export type { CodexArgv }
export { codex_agent_argv }
