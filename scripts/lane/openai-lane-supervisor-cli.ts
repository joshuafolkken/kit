#!/usr/bin/env tsx
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { lane_registry } from './lane-registry'
import { openai_lane_supervisor } from './openai-lane-supervisor'

const ARGV_OFFSET = 2
const [issue, nonce] = process.argv.slice(ARGV_OFFSET)

function worker_profile(profile: AgentProfile | undefined): AgentProfile | undefined {
	if (profile !== undefined) return profile
	const resolved = agent_role_profile.resolve(agent_role_profile.WORKER)

	return resolved.kind === 'profile' ? resolved.profile : undefined
}

function openai_profile(profile: AgentProfile | undefined): AgentProfile | undefined {
	const worker = worker_profile(profile)

	return worker?.provider === 'openai' ? worker : undefined
}

async function main(): Promise<number> {
	if (issue === undefined || nonce === undefined) return 1
	const lane = await lane_registry.find_open_lane(issue)
	if (lane === undefined) return 1
	const profile = openai_profile(lane.profile)
	if (profile === undefined) return 1

	return await openai_lane_supervisor.supervise(lane, profile, nonce)
}

process.exitCode = await main()
