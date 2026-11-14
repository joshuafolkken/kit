import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { run_carry_session } from '#scripts/run/carry/run-carry-session'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import { run_headless_keys } from '#scripts/run/run-headless-keys'
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

function scheduler_arguments(request: LaunchRequest): ReadonlyArray<string> {
	if (request.profile?.role !== agent_profile_schema.SCHEDULER) return []
	const keys = [run_carry_session.KEY, ...run_headless_keys.MARK_KEYS]

	return keys.flatMap((key) =>
		request.env?.[key] === undefined
			? []
			: [CONFIG_FLAG, `${SHELL_SET}${key}=${JSON.stringify(request.env[key])}`],
	)
}

// Only the launcher's explicit mark grants identity; a checkout path or inherited mark cannot.
function is_codex(request: LaunchRequest): boolean {
	return request.profile?.provider === 'openai' && request.argv.command === 'codex'
}

function arguments_for(request: LaunchRequest): ReadonlyArray<string> {
	const { argv } = request

	if (!is_codex(request) || argv.ends_with_prompt !== true) return argv.args

	const identity = is_codex_worker(request)
		? identity_arguments(request)
		: scheduler_arguments(request)

	return [...argv.args.slice(0, -1), ...identity, ...argv.args.slice(-1)]
}

const codex_launch_identity = { arguments_for }

export { codex_launch_identity }
