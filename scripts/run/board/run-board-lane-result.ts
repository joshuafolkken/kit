import { lstatSync } from 'node:fs'
import type { AgentResult } from '#scripts/agent/agent-event'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_liveness } from '#scripts/run/run-liveness'

// joshuafolkken/kit#6577: what each open lane's transcript says — its result and when it was last
// written. The board reads it every second, so a transcript is parsed again only once it changed.

interface LaneResult {
	result?: AgentResult | undefined
	written_ms: number
}

const RESULTS = stamped_memo.create<AgentResult | undefined>()

function written_of(output: string): number | undefined {
	try {
		return lstatSync(output).mtimeMs
	} catch {
		return undefined
	}
}

// An unrecorded, absent or unreadable transcript is `undefined`.
function lane_result(output: string | undefined): LaneResult | undefined {
	const written_ms = output === undefined ? undefined : written_of(output)
	if (output === undefined || written_ms === undefined) return undefined

	const result = RESULTS.of(
		output,
		stamped_memo.file_stamp(output),
		() => run_liveness.read_agent_state(output)?.result,
	)

	return { result, written_ms }
}

// Each open lane's transcript, by issue; a lane without one is absent. A closed lane's is forgotten.
function results_of(lanes: ReadonlyArray<LaneInfo>): Map<string, LaneResult> {
	const outputs = lanes.map((lane) => lane.output)
	const results = new Map<string, LaneResult>()

	for (const { issue, output } of lanes) {
		const read = lane_result(output)

		if (read !== undefined) results.set(issue, read)
	}

	RESULTS.keep(new Set(outputs.filter((output) => output !== undefined)))

	return results
}

const run_board_lane_result = { results_of }

export { run_board_lane_result }
export type { LaneResult }
