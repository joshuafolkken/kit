import path from 'node:path'
import { session_language } from '#scripts/josh/session-language'
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

// The lines are for a person to read, so they follow the session language; the directory and the
// `lane:close` command stay as they are (joshuafolkken/kit#7667).
function note_lines(issue: string, directory: string): ReadonlyArray<string> {
	const lane = `\`${directory}\``
	const seat = seat_of(directory)
	const close = `\`pnpm josh lane:close ${issue}\``

	if (session_language.is_japanese(session_language.resolve_session_lang().lang)) {
		return [
			`- レーンのディレクトリ: ${lane}`,
			`- レーンを残す間、席 ${seat} は確保したまま`,
			`- 返却: ${close}`,
		]
	}

	return [
		`- Lane directory: ${lane}`,
		`- Seat ${seat} stays held while the lane is kept`,
		`- Give it back: ${close}`,
	]
}

function lane_note(issue: string, directory: string): string {
	return ['---', ...note_lines(issue, directory)].join('\n')
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
