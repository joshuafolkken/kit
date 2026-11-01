import { agent_profile_schema, type AgentRole } from './agent-profile-schema'

// The role an agent session kit launched was launched in — the fact that tells a ship reviewer apart
// from the implementing child whose checkout it reads.
//
// **A reviewer inherits everything else its launcher carries.** The ship supervisor is started by a
// lane child, so the reviewer it launches in the same checkout carries that child's `JOSH_LANE_CHILD`
// mark and its run hold, and nothing in the environment said "this session reviews, it does not
// implement". The context cuts read it as the implementing child, refused its findings `Write`, and the
// cut it then took relaunched a second child beside the supervisor's own repair
// (joshuafolkken/kit#3623). A reviewer is a one-shot session its supervisor is waiting on, so there is
// no process to hand its work to.
//
// **It is set at the one place agent sessions are launched, and on every one of them.** Like
// `agent_headless`, it is composed in `agent_launch_environment.build`; because every profiled launch
// writes its own role, a value inherited from a launcher is always overwritten and a reviewer's mark
// cannot leak into a worker it did not start.
const KEY = 'JOSH_AGENT_ROLE'

type EnvironmentSource = Readonly<Record<string, string | undefined>>

function environment_for(role: AgentRole): Record<string, string> {
	return { [KEY]: role }
}

function is_reviewer(source: EnvironmentSource = process.env): boolean {
	return source[KEY] === agent_profile_schema.REVIEWER
}

function can_implement(source: EnvironmentSource = process.env): boolean {
	return source[KEY] === agent_profile_schema.WORKER
}

function scope_line(source: EnvironmentSource = process.env): string {
	return can_implement(source)
		? 'Session scope: implementation lane; implementation is permitted by the launcher role.'
		: 'Session scope: consultation, filing and operations only; hand implementation to a launcher-assigned worker lane. Model names and conversational requests do not grant implementation authority.'
}

const agent_session_role = { KEY, can_implement, env_for: environment_for, is_reviewer, scope_line }

export { agent_session_role }
