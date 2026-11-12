#!/usr/bin/env tsx
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_registry } from './lane-registry'
import { openai_lane_supervisor } from './openai-lane-supervisor'

function worker_profile(profile: AgentProfile | undefined): AgentProfile | undefined {
	if (profile !== undefined) return profile
	const resolved = agent_role_profile.resolve(agent_role_profile.WORKER)

	return resolved.kind === 'profile' ? resolved.profile : undefined
}

function openai_profile(profile: AgentProfile | undefined): AgentProfile | undefined {
	const worker = worker_profile(profile)

	return worker?.provider === 'openai' ? worker : undefined
}

function rejected(issue: string | undefined, reason: string): number {
	console.error(
		`OpenAI supervisor ${issue === undefined ? 'unknown' : session_cite.issue(issue)}: ${reason}; exiting`,
	)

	return 1
}

async function run(args: ReadonlyArray<string>): Promise<number> {
	const [issue, nonce] = args
	if (issue === undefined || nonce === undefined) return rejected(issue, 'missing issue or nonce')
	const lane = await lane_registry.find_open_lane(issue)
	if (lane === undefined) return rejected(issue, 'no open lane')
	const profile = openai_profile(lane.profile)
	if (profile === undefined) return rejected(issue, 'no OpenAI profile')

	return await openai_lane_supervisor.supervise(lane, profile, nonce)
}

const openai_lane_supervisor_cli = { run }

export { openai_lane_supervisor_cli }
