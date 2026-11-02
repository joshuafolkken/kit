import path from 'node:path'
import { lane_environment } from '#scripts/lane/lane-environment'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_registry } from '#scripts/lane/lane-registry'

// A park from inside a lane keeps that lane and its seat, so the park comment names the lane
// directory, the held seat and the way to give it back (joshuafolkken/kit#5840). The child wrote the
// three by hand on every park; the park writes them now.

const UNKNOWN_SEAT = 'unknown'

function seat_of(directory: string): string {
	const content = lane_registry.read_environment(directory)
	const seat = content === undefined ? undefined : lane_environment.read_lane_seat(content)

	return seat === undefined ? UNKNOWN_SEAT : String(seat)
}

function lane_note(issue: string, directory: string): string {
	return [
		'---',
		`- Lane directory: \`${directory}\``,
		`- Seat ${seat_of(directory)} stays held while the lane is kept`,
		`- Give it back: \`pnpm josh lane:close ${issue}\``,
	].join('\n')
}

// `body` unchanged outside a lane.
function with_lane_note(body: string, directory: string): string {
	const issue = lane_paths.lane_issue_of(directory)

	if (issue === undefined) return body

	const lane = lane_paths.checkout_of(path.resolve(directory))

	return `${body.trimEnd()}\n\n${lane_note(issue, lane)}\n`
}

const run_park_lane = { with_lane_note }

export { run_park_lane }
