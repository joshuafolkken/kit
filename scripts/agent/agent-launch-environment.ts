import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import type { AgentProfile } from './agent-role-profile'

const OPENAI_PROVIDER = 'openai'
const CACHE_PATH = ['node_modules', '.cache', 'josh', OPENAI_PROVIDER]
const DIRECTORY_MODE = 0o700

type LaunchEnvironment = Readonly<Record<string, string | undefined>>

function openai_environment(cwd: string): LaunchEnvironment {
	const temporary_directory = path.join(cwd, ...CACHE_PATH)

	mkdirSync(temporary_directory, { recursive: true, mode: DIRECTORY_MODE })

	const token = gh_cli_token.get()

	return token === undefined
		? { TMPDIR: temporary_directory }
		: { GH_TOKEN: token, TMPDIR: temporary_directory }
}

function build(
	cwd: string,
	profile: AgentProfile | undefined,
	environment: LaunchEnvironment = {},
): LaunchEnvironment {
	if (profile?.provider !== OPENAI_PROVIDER) return environment

	return { ...openai_environment(cwd), ...environment }
}

const agent_launch_environment = { build }

export { agent_launch_environment }
