import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { run_liveness } from '#scripts/run/run-liveness'
import { expect, it } from 'vitest'
import { lane_dispatch } from './lane-dispatch'
import type { LaneInfo } from './lane-registry'

const lane: LaneInfo = {
	issue: '1749',
	branch: '1749-lane',
	directory: '/nonexistent/dispatch-log',
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}
const log = lane_dispatch.default_log_path(lane)

it('is a path `run:liveness` can read, so the record is never one it refuses', () => {
	expect(run_liveness.to_safe_path(log)).toBeDefined()
})

it('is in the temp directory, so it survives `lane:close`', () => {
	expect(log.startsWith(PLATFORM_TEMP_ROOT)).toBe(true)
})

it('names the issue, so a person can find the file by eye', () => {
	expect(log).toContain(lane.issue)
})

it('differs between two lanes sharing an issue number across repositories', () => {
	const elsewhere = { ...lane, directory: `${lane.directory}-other-repository` }

	expect(lane_dispatch.default_log_path(elsewhere)).not.toBe(log)
})
