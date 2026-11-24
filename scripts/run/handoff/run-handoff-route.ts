import type { AgentProfile } from '#scripts/agent/agent-profile-schema'
import { agent_role_profile, type AgentEnvironment } from '#scripts/agent/agent-role-profile'
import { agent_worker_profile } from '#scripts/agent/agent-worker-profile'
import { package_manifest } from '#scripts/lib/package-manifest'
import type { WorkflowKeyword } from './run-handoff-args'

// joshuafolkken/kit#8891: with `josh.handoff.route` on, the `run:handoff` kickoff child (filing and
// planning) runs on the weakest `josh.worker` profile's model and effort instead of the scheduler's
// default. It keeps the scheduler role, so it still reads `CLAUDE.md`. Only `kickoff` is routed: the
// retrospective and the runs that implement keep their role's profile. A model or effort a person named
// for the scheduler wins, and `route: false` is the one-step revert.

interface RouteInput {
	keyword: WorkflowKeyword | undefined
	resolved: AgentProfile
	environment: AgentEnvironment
	cwd: string
}

function is_route_on(cwd: string): boolean {
	const manifest = package_manifest.read_manifest_if_valid(
		cwd,
		package_manifest.josh_schemas.handoff,
	)

	return manifest?.josh?.handoff?.route ?? false
}

function weakest_of(cwd: string): AgentProfile | undefined {
	const result = agent_worker_profile.read(cwd)
	if (result.kind !== 'settings') return undefined

	return result.settings.profiles[0]?.agent
}

function is_pinned(environment: AgentEnvironment): boolean {
	const keys = agent_role_profile.role_keys(agent_role_profile.SCHEDULER)

	return keys.some((key) => environment[key] !== undefined && environment[key] !== '')
}

function is_routed(input: RouteInput): boolean {
	if (input.keyword !== 'kickoff' || is_pinned(input.environment)) return false

	return is_route_on(input.cwd)
}

// The profile the child starts on: the resolved one unless the kickoff route applies and the weakest
// profile runs on the same provider.
function profile_of(input: RouteInput): AgentProfile {
	const { resolved } = input
	if (!is_routed(input)) return resolved

	const weakest = weakest_of(input.cwd)
	if (weakest?.provider !== resolved.provider) return resolved

	return { ...resolved, model: weakest.model, effort: weakest.effort }
}

const run_handoff_route = { profile_of }

export type { RouteInput }
export { run_handoff_route }
