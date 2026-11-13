import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import { agent_profile_schema } from './agent-profile-schema'

const CONFIG_FLAG = '-c'
const SHELL_SET = 'shell_environment_policy.set.'

function identity_environment(request: LaunchRequest): Record<string, string | undefined> {
	return {
		[lane_paths.LANE_ROOT_KEY]: process.env[lane_paths.LANE_ROOT_KEY],
		...request.env,
	}
}

function identity_arguments(request: LaunchRequest): ReadonlyArray<string> {
	const source = identity_environment(request)
	if (!lane_child_marker.is_child_of(request.cwd, source)) return []

	return [lane_child_marker.KEY, lane_paths.LANE_ROOT_KEY].flatMap((key) =>
		source[key] === undefined
			? []
			: [CONFIG_FLAG, `${SHELL_SET}${key}=${JSON.stringify(source[key])}`],
	)
}

function is_codex_worker(request: LaunchRequest): boolean {
	const { argv, profile } = request

	return (
		profile?.provider === 'openai' &&
		profile.role === agent_profile_schema.WORKER &&
		argv.command === 'codex' &&
		argv.ends_with_prompt === true
	)
}

// Only the launcher's explicit mark grants identity; a checkout path or inherited mark cannot.
function arguments_for(request: LaunchRequest): ReadonlyArray<string> {
	const { argv } = request
	if (!is_codex_worker(request)) return argv.args

	return [...argv.args.slice(0, -1), ...identity_arguments(request), ...argv.args.slice(-1)]
}

const codex_launch_identity = { arguments_for }

export { codex_launch_identity }
