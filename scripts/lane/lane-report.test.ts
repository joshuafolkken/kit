import { describe, expect, it } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_report } from './lane-report'

// joshuafolkken/kit#1490: the listing is what answers "how many lanes are open, for which issue, and
// on which ports". The ports are resolved through `ports/index.js` rather than added up here, so the
// numbers printed are the ones `josh port` and `playwright.config.ts` resolve inside the lane.

const DEV_BASE = 5173
const PREVIEW_BASE = 4173
const SEED = 6
const LANE_BRANCH = 'lane/1490'
const LANE_DIRECTORY = '/w/.kit-lanes/1490'

function lane(overrides: Partial<LaneInfo> = {}): LaneInfo {
	return {
		issue: '1490',
		branch: LANE_BRANCH,
		directory: LANE_DIRECTORY,
		seed: SEED,
		is_stranded: false,
		...overrides,
	}
}

describe('listing the open lanes', () => {
	it('says which issue, which ports and where, on one line per lane', () => {
		const line = lane_report.describe_lane(lane())

		expect(line).toContain('#1490')
		expect(line).toContain(`dev ${String(DEV_BASE + SEED)}`)
		expect(line).toContain(`preview ${String(PREVIEW_BASE + SEED)}`)
		expect(line).toContain(LANE_DIRECTORY)
		expect(line).toContain(lane_report.OPEN_STATE)
	})

	it('resolves the ports through the same module the lane itself will read', () => {
		expect(lane_report.development_port(SEED)).toBe(DEV_BASE + SEED)
		expect(lane_report.preview_port(SEED)).toBe(PREVIEW_BASE + SEED)
	})

	it('says so plainly when nothing is open', () => {
		expect(lane_report.describe_lanes([])).toBe(lane_report.NO_LANES)
	})

	it('lists one line per lane', () => {
		const lines = lane_report.describe_lanes([lane(), lane({ issue: '1491' })]).split('\n')

		expect(lines).toHaveLength(2)
	})

	it('marks a lane whose work tree is gone as stranded', () => {
		const line = lane_report.describe_lane(lane({ is_stranded: true, seed: undefined }))

		expect(line).toContain(lane_report.STRANDED_STATE)
	})

	// Shown rather than hidden: this is the state that stops the next `lane:open`, and a refusal
	// whose cause was invisible in the listing would look like the command misbehaving.
	it('marks a live lane whose seat could not be read as unreadable', () => {
		const line = lane_report.describe_lane(lane({ seed: undefined }))

		expect(line).toContain(lane_report.UNREADABLE_STATE)
		expect(line).not.toContain(`dev ${String(DEV_BASE)}`)
	})
})

describe('the line printed when a lane opens', () => {
	it('names the branch and the ports the lane got', () => {
		const opened = lane_report.describe_opened(lane())

		expect(opened).toContain(LANE_BRANCH)
		expect(opened).toContain(`PORT_SEED=${String(SEED)}`)
		expect(opened).toContain(String(PREVIEW_BASE + SEED))
	})
})
