import { lstatSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

const AGENT_COMMAND = 'codex'
const AGENT_FLAGS: ReadonlyArray<string> = ['exec', '--sandbox', 'workspace-write']
const MODEL_FLAG = '--model'
const CONFIG_FLAG = '-c'
const JSON_FLAG = '--json'
const NETWORK_CONFIG = 'sandbox_workspace_write.network_access=true'
const SQLITE_CACHE_PATH = ['node_modules', '.cache', 'josh', 'openai']
const EPHEMERAL_FLAG = '--ephemeral'
const ADD_DIRECTORY_FLAG = '--add-dir'
const GIT_DIRECTORY = '.git'
const LEDGER_DIRECTORY = 'docs'

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

function persistence_arguments(profile: AgentProfile): ReadonlyArray<string> {
	return profile.role === agent_role_profile.WORKER ? [] : [EPHEMERAL_FLAG]
}

function ensure_ledger_directory(directory: string): void {
	const current = lstatSync(directory, { throwIfNoEntry: false })

	if (current === undefined) mkdirSync(directory, { recursive: true })
	else if (!current.isDirectory() || current.isSymbolicLink()) {
		throw new Error(`Ledger directory must be a real directory: ${directory}`)
	}
}

// Only the ledger's parent directory is writable outside a lane, never the primary checkout root.
function ledger_arguments(
	common_directory: string | undefined,
	profile: AgentProfile,
): ReadonlyArray<string> {
	if (common_directory === undefined || profile.role !== agent_role_profile.WORKER) return []
	if (path.basename(common_directory) !== GIT_DIRECTORY) return []

	const directory = path.join(path.dirname(common_directory), LEDGER_DIRECTORY)

	ensure_ledger_directory(directory)

	return [ADD_DIRECTORY_FLAG, directory]
}

function lane_arguments(cwd: string, profile: AgentProfile): ReadonlyArray<string> {
	const common_directory = git_common_directory.resolve(cwd)
	const additional_directory =
		common_directory === undefined ? [] : [ADD_DIRECTORY_FLAG, common_directory]

	return [
		CONFIG_FLAG,
		sqlite_config(cwd),
		...persistence_arguments(profile),
		...additional_directory,
		...ledger_arguments(common_directory, profile),
	]
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
			...(cwd === undefined ? [] : lane_arguments(cwd, profile)),
			JSON_FLAG,
			invocation,
		],
	}
}

const codex_agent_argv = { AGENT_COMMAND, AGENT_FLAGS, build }

export type { CodexArgv }
export { codex_agent_argv }
