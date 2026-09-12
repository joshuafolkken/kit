import { describe, expect, it } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_report } from './lane-report'

// joshuafolkken/kit#1490, joshuafolkken/kit#1494: the listing answers "how many lanes are open, for
// which issue, on which seat and ports". The registry resolves the ports through `ports/index.js`
// when it reads each lane's `.env`, so the report only displays them — the numbers are the ones
// `josh port` and `playwright.config.ts` resolve inside the lane.

const SEAT = 6
const DEV_PORT = 5236
const PREVIEW_PORT = 4236
const LANE_BRANCH = '1490-lane'
const LANE_DIRECTORY = '/w/.kit-lanes/1490'

function lane(overrides: Partial<LaneInfo> = {}): LaneInfo {
	return {
		issue: '1490',
		branch: LANE_BRANCH,
		directory: LANE_DIRECTORY,
		seat: SEAT,
		development_port: DEV_PORT,
		preview_port: PREVIEW_PORT,
		output: undefined,
		is_stranded: false,
		...overrides,
	}
}

const UNREADABLE = { seat: undefined, development_port: undefined, preview_port: undefined }

describe('listing the open lanes', () => {
	it('says which issue, which seat and ports, and where, on one line per lane', () => {
		const line = lane_report.describe_lane(lane())

		expect(line).toContain('#1490')
		expect(line).toContain(`seat ${String(SEAT)}`)
		expect(line).toContain(`dev ${String(DEV_PORT)}`)
		expect(line).toContain(`preview ${String(PREVIEW_PORT)}`)
		expect(line).toContain(LANE_DIRECTORY)
		expect(line).toContain(lane_report.OPEN_STATE)
	})

	it('says so plainly when nothing is open', () => {
		expect(lane_report.describe_lanes([])).toBe(lane_report.NO_LANES)
	})

	it('lists one line per lane', () => {
		const lines = lane_report.describe_lanes([lane(), lane({ issue: '1491' })]).split('\n')

		expect(lines).toHaveLength(2)
	})

	it('marks a lane whose work tree is gone as stranded', () => {
		const line = lane_report.describe_lane(lane({ is_stranded: true, ...UNREADABLE }))

		expect(line).toContain(lane_report.STRANDED_STATE)
	})

	// Shown rather than hidden: this is the state that stops the next `lane:open`, and a refusal
	// whose cause was invisible in the listing would look like the command misbehaving.
	it('marks a live lane whose seat could not be read as unreadable', () => {
		const line = lane_report.describe_lane(lane(UNREADABLE))

		expect(line).toContain(lane_report.UNREADABLE_STATE)
		expect(line).toContain('seat -')
	})
})

// joshuafolkken/kit#1713: the listing is where a session that did not open a lane finds the file to
// poll, so the record is a labelled column of its own rather than something read off the directory.
describe('the recorded output path in the listing', () => {
	const UNIT_OUTPUT = '/home/dev/.claude/projects/kit/session/subagents/agent-7.jsonl'

	it('names the file the lane’s unit writes', () => {
		const line = lane_report.describe_lane(lane({ output: UNIT_OUTPUT }))

		expect(line).toContain(`output ${UNIT_OUTPUT}`)
	})

	// A shorter row would read as a field the caller failed to notice; the point is to see that the
	// record is missing.
	it('says so plainly when the lane records none', () => {
		expect(lane_report.describe_lane(lane())).toContain('output -')
	})

	it('keeps the directory and the path apart', () => {
		const line = lane_report.describe_lane(lane({ output: UNIT_OUTPUT }))

		expect(line).toContain(LANE_DIRECTORY)
		expect(line.indexOf(LANE_DIRECTORY)).toBeLessThan(line.indexOf(UNIT_OUTPUT))
	})
})

describe('the line printed when a lane opens', () => {
	it('names the branch, the seat and the ports the lane got', () => {
		const opened = lane_report.describe_opened(lane())

		expect(opened).toContain(LANE_BRANCH)
		expect(opened).toContain(`seat ${String(SEAT)}`)
		expect(opened).toContain(String(PREVIEW_PORT))
	})
})
