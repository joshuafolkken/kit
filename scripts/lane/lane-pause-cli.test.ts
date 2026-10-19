import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_pause } from './lane-pause'
import { lane_pause_cli } from './lane-pause-cli'

// joshuafolkken/kit#4198: `josh lane:pause` / `lane:resume` take one issue or `--all`, and a named lane
// with nothing to signal exits non-zero.

const ISSUE = '4198'
const OTHER = '4197'
const SUCCESS = 0
const FAILURE = 1
const TREE = [101, 102]
const USAGE = [
	'Usage: josh lane:pause <issue-number> | josh lane:pause --all',
	'       josh lane:resume <issue-number> | josh lane:resume --all',
].join('\n')

const pause_lane = vi.spyOn(lane_pause, 'pause_lane')
const resume_lane = vi.spyOn(lane_pause, 'resume_lane')
const open_issues = vi.spyOn(lane_pause, 'open_issues')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')

beforeEach(() => {
	vi.clearAllMocks()
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	pause_lane.mockReturnValue(TREE)
	resume_lane.mockReturnValue(TREE)
})

describe('lane_pause_cli.run — one lane', () => {
	it('pauses the named lane and reports how many processes it stopped', async () => {
		expect(await lane_pause_cli.run(['pause', ISSUE])).toBe(SUCCESS)
		expect(pause_lane).toHaveBeenCalledWith(ISSUE)
		expect(info).toHaveBeenCalledWith('lane:pause #4198: paused 2 process(es)')
	})

	it('resumes the named lane', async () => {
		expect(await lane_pause_cli.run(['resume', ISSUE])).toBe(SUCCESS)
		expect(resume_lane).toHaveBeenCalledWith(ISSUE)
		expect(pause_lane).not.toHaveBeenCalled()
	})

	it('exits non-zero when the named lane has no child process to signal', async () => {
		pause_lane.mockReturnValue([])

		expect(await lane_pause_cli.run(['pause', ISSUE])).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith('lane:pause #4198: no child process running — nothing paused')
	})
})

describe('lane_pause_cli.run — --all', () => {
	it('signals every open lane, and an idle one is not a failure', async () => {
		open_issues.mockResolvedValue([OTHER, ISSUE])
		pause_lane.mockReturnValueOnce([])

		expect(await lane_pause_cli.run(['pause', '--all'])).toBe(SUCCESS)
		expect(pause_lane.mock.calls).toStrictEqual([[OTHER], [ISSUE]])
	})
})

describe('lane_pause_cli.run — the usage', () => {
	it.each([
		['no target', ['pause']],
		['two issues', ['pause', ISSUE, OTHER]],
		['a non-number issue', ['pause', '#4198']],
		['an unknown verb', ['stop', ISSUE]],
	])('refuses %s with the usage line, signalling nothing', async (_label, argv) => {
		expect(await lane_pause_cli.run(argv)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(USAGE)
		expect(pause_lane).not.toHaveBeenCalled()
	})
})
