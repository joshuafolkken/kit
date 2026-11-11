import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { agent_headless } from './agent-headless'
import type { AgentProfile } from './agent-profile-schema'
import { agent_session_role } from './agent-session-role'

const OPENAI_PROVIDER = 'openai'

type LaunchEnvironment = Readonly<Record<string, string | undefined>>

// An OpenAI child reads gh's keyring and the real Codex home as a Claude child does: every Codex role
// runs with full access (joshuafolkken/kit#5438), so neither a GH_TOKEN nor a lane-local home is passed.
function build(
	profile: AgentProfile | undefined,
	environment: LaunchEnvironment = {},
): LaunchEnvironment {
	if (profile === undefined) return { ...environment, [agent_session_role.KEY]: undefined }

	const marked = {
		...agent_headless.environment(),
		...environment,
		...agent_session_role.env_for(profile.role),
	}

	return profile.provider === OPENAI_PROVIDER ? { TMPDIR: PLATFORM_TEMP_ROOT, ...marked } : marked
}

const agent_launch_environment = { build }

export { agent_launch_environment }
