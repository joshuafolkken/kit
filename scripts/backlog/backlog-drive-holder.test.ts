import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_hold, type RunHold } from '#scripts/run/hold/run-hold'
import { run_hold_live } from '#scripts/run/hold/run-hold-live'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_holder } from './backlog-drive-holder'

const ISSUE = '9104'
const OTHER = '9096'
const ROOT_PID = 71_286
const LANE_PID = 5150
const GIT_FOLDER = '/repo/.git'
const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: `/lanes/${ISSUE}`,
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

function labelled(labels: ReadonlyArray<string>): StateRead {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

beforeEach(() => {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_FOLDER)
	vi.spyOn(run_hold, 'read_hold').mockReturnValue({ kind: 'free' })
	vi.spyOn(run_hold_live, 'live_hold_at').mockReturnValue(undefined)
	vi.spyOn(run_hold_live, 'live_hold').mockReturnValue(undefined)
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(labelled([]))
})

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#9104: what says another run already holds the issue a drive is about to open.
describe('backlog_drive_holder.holder — the primary checkout', () => {
	it('names the root run that holds the same issue', async () => {
		vi.mocked(run_hold_live.live_hold_at).mockReturnValue({ issue: ISSUE, pid: ROOT_PID })

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toContain(String(ROOT_PID))
		expect(run_hold_live.live_hold_at).toHaveBeenCalledWith(GIT_FOLDER)
	})

	it('answers nothing when the root run holds another issue and nothing else does', async () => {
		vi.mocked(run_hold_live.live_hold_at).mockReturnValue({ issue: OTHER, pid: ROOT_PID })

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toBeUndefined()
	})
})

describe('backlog_drive_holder.holder — an open lane', () => {
	it('names the lane whose run holds it live', async () => {
		vi.mocked(lane_registry.find_open_lane).mockResolvedValue(LANE)
		vi.mocked(run_hold_live.live_hold).mockReturnValue({ issue: ISSUE, pid: LANE_PID })

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toContain(LANE.directory)
		expect(run_hold_live.live_hold).toHaveBeenCalledWith(LANE.directory)
	})

	it('keeps a lane whose child ended for the drive to relaunch, without reading the label', async () => {
		vi.mocked(lane_registry.find_open_lane).mockResolvedValue(LANE)
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue(labelled([IN_PROGRESS_LABEL]))

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toBeUndefined()
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_holder.holder — no lane', () => {
	it('names an in-progress label read fresh', async () => {
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue(labelled([IN_PROGRESS_LABEL]))

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toContain(IN_PROGRESS_LABEL)
		expect(issue_state_cli.read_issue).toHaveBeenCalledWith(ISSUE)
	})

	it('takes over the in-progress a crashed root run left beside its stale record', async () => {
		const hold: RunHold = { issue: ISSUE, taken_at: new Date(0).toISOString(), pid: ROOT_PID }

		vi.mocked(run_hold.read_hold).mockReturnValue({ kind: 'stale', hold })
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue(labelled([IN_PROGRESS_LABEL]))

		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toBeUndefined()
		expect(issue_state_cli.read_issue).not.toHaveBeenCalled()
	})

	it('answers nothing for an issue without the label', async () => {
		await expect(backlog_drive_holder.holder(ISSUE)).resolves.toBeUndefined()
	})
})
