import { git_stash, type StashEntry } from '#scripts/git/stash/git-stash'
import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_launch } from './backlog-drive-launch'
import { backlog_drive_owner } from './backlog-drive-owner'

const OWNER = '4242'
const FIRST = '3300'
const SECOND = '3301'
const LOST_OWNER = 'no longer owns'
const MESSAGE = backlog_drive_launch.LATEST_STASH_MESSAGE
const LATEST: StashEntry = { selector: 'stash@{0}', subject: `On main: ${MESSAGE}` }
const OTHER: StashEntry = { selector: 'stash@{1}', subject: 'On 3200-lane: 3200: parked' }
const DUPLICATE: StashEntry = { selector: 'stash@{2}', subject: `On main: ${MESSAGE}` }

function launched_with(): ReadonlyArray<string | undefined> {
	return vi.mocked(lane_launch_cli.launch_lane).mock.calls.map(([context]) => context.stash)
}

beforeEach(() => {
	vi.spyOn(backlog_drive_owner, 'assert_current').mockResolvedValue()
	vi.spyOn(lane_launch_cli, 'launch_lane').mockResolvedValue({ kind: 'launched', pid: '1' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_launch.launch', () => {
	it('passes the josh latest stash to the lane when it is on the stack', async () => {
		vi.spyOn(git_stash, 'list').mockResolvedValue([OTHER, LATEST])

		await expect(backlog_drive_launch.launch(FIRST, OWNER)).resolves.toBe('launched')
		expect(lane_launch_cli.launch_lane).toHaveBeenCalledWith({ issue: FIRST, stash: MESSAGE })
	})

	it('launches without a stash when none was pushed', async () => {
		vi.spyOn(git_stash, 'list').mockResolvedValue([OTHER])

		await backlog_drive_launch.launch(FIRST, OWNER)

		expect(launched_with()).toStrictEqual([undefined])
	})

	it('launches the second lane without a stash once the first popped it', async () => {
		vi.spyOn(git_stash, 'list').mockResolvedValueOnce([LATEST]).mockResolvedValueOnce([])

		await backlog_drive_launch.launch(FIRST, OWNER)
		await backlog_drive_launch.launch(SECOND, OWNER)

		expect(launched_with()).toStrictEqual([MESSAGE, undefined])
	})

	it('refuses before reading the stash when the driver lost its owner', async () => {
		const list = vi.spyOn(git_stash, 'list').mockResolvedValue([LATEST])

		vi.mocked(backlog_drive_owner.assert_current).mockRejectedValue(new Error(LOST_OWNER))

		await expect(backlog_drive_launch.launch(FIRST, OWNER)).rejects.toThrow(LOST_OWNER)
		expect(list).not.toHaveBeenCalled()
		expect(lane_launch_cli.launch_lane).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_launch.launch with two stashes under the message', () => {
	it('does not guess between them and says so', async () => {
		vi.spyOn(git_stash, 'list').mockResolvedValue([LATEST, DUPLICATE])
		const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await backlog_drive_launch.launch(FIRST, OWNER)

		expect(launched_with()).toStrictEqual([undefined])
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(DUPLICATE.selector))
	})

	it('stays quiet when only one is on the stack', async () => {
		vi.spyOn(git_stash, 'list').mockResolvedValue([LATEST])
		const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await backlog_drive_launch.launch(FIRST, OWNER)

		expect(warn).not.toHaveBeenCalled()
	})
})
