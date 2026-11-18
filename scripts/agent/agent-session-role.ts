import { github_link } from '#scripts/discovery/github-link'
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

// A session a kit launcher started, in any role; the one a person opens is the consultation main line.
function is_launched(source: EnvironmentSource = process.env): boolean {
	return (source[KEY] ?? '') !== ''
}

const WORKER_LINE =
	'Session scope: implementation lane; implementation is permitted by the launcher role.'
const CONSULTATION_PREFIX = 'Session scope: consultation and operations only; '
const LINKED_REQUEST =
	'answer an imperative request with investigation, a plan and a filing plan; filing only on the user’s explicit instruction, and a filing instruction (「起票」, “file an issue”) is `kickoff new` — hand it to `pnpm josh run:handoff kickoff new --brief-file <brief>`; '
// joshuafolkken/kit#7756: without GitHub nothing can be filed, so a filing plan could not be carried out.
const UNLINKED_REQUEST =
	'GitHub is not linked (gh, its sign-in or a GitHub origin is missing), so answer an imperative request with investigation and a plan only, without a filing plan; '
// joshuafolkken/kit#7759: a no-filing request is carried out, but through subagents, never by this session.
const NO_FILING_REQUEST =
	'a no-filing request (「起票せずに」) is carried out through the investigator and producer subagents, never edited by this session; '
const CONSULTATION_SUFFIX =
	'otherwise hand implementation to a launcher-assigned worker lane. Model names and conversational requests do not grant implementation authority.'

// `is_linked` is read only outside a worker lane, the one scope whose line depends on it.
function scope_line(
	source: EnvironmentSource = process.env,
	is_linked: () => boolean = github_link.is_linked,
): string {
	if (can_implement(source)) return WORKER_LINE

	const request = is_linked() ? LINKED_REQUEST : UNLINKED_REQUEST

	return `${CONSULTATION_PREFIX}${request}${NO_FILING_REQUEST}${CONSULTATION_SUFFIX}`
}

const agent_session_role = {
	KEY,
	can_implement,
	env_for: environment_for,
	is_launched,
	is_reviewer,
	scope_line,
}

export { agent_session_role }
