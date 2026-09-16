import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import type { AgentProfile } from './agent-role-profile'

const OPENAI_PROVIDER = 'openai'

type LaunchEnvironment = Readonly<Record<string, string | undefined>>

function openai_environment(): LaunchEnvironment {
	const token = gh_cli_token.get()

	return token === undefined
		? { TMPDIR: PLATFORM_TEMP_ROOT }
		: { GH_TOKEN: token, TMPDIR: PLATFORM_TEMP_ROOT }
}

function build(
	_cwd: string,
	profile: AgentProfile | undefined,
	environment: LaunchEnvironment = {},
): LaunchEnvironment {
	if (profile?.provider !== OPENAI_PROVIDER) return environment

	return { ...openai_environment(), ...environment }
}

const agent_launch_environment = { build }

export { agent_launch_environment }
