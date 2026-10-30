import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { IN_PROGRESS_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_state } from '#scripts/lane/lane-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_next } from './epic-next'
import { epic_next_read } from './epic-next-read'
import { epic_solo_stale } from './epic-solo-stale'
import { epic_stopped_fixture } from './epic-stopped-fixture'

const { REPO, EPIC, RUNNING, STOPPED, lane, record, records, snapshot } = epic_stopped_fixture
const ARGV = [EPIC, '--repo', REPO, '--lanes']
const OTHER = '702'

function labelled_stopped(labels: ReadonlyArray<string> = [IN_PROGRESS_LABEL]): void {
	const issue = auto_ok_fixture.issue(Number(STOPPED), CREATED_EARLIER, [...labels])

	vi.mocked(git_gh_command.issue_list_by_label_in_repo).mockResolvedValue(listing_of([issue]))
}

async function full_local_occupancy(): Promise<void> {
	const rows = await lane_process_table.read_table()
	const active = rows?.[0]

	if (active === undefined) throw new Error('missing active process fixture')
	vi.mocked(lane_process_table.read_table).mockResolvedValue([
		active,
		{ ...active, pid: active.pid + 1, command: `claude -p fullrun #${OTHER}` },
	])
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane(RUNNING), lane(STOPPED), lane(OTHER)])
	vi.mocked(lane_state.read_states).mockResolvedValue(records().set(OTHER, record(OTHER)))
}

beforeEach(() => {
	epic_stopped_fixture.arrange()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('epic:next occupancy protections after stopped labels are discounted', () => {
	it('keeps the solo holder alive at the release probe across an idle cut snapshot', async () => {
		labelled_stopped([IN_PROGRESS_LABEL, RUN_SOLO_LABEL])
		vi.spyOn(lane_await, 'is_process_running_default').mockReturnValue(true)
		vi.spyOn(epic_solo_stale.io, 'settle').mockResolvedValue(undefined)

		expect(await epic_next.run(ARGV)).toBe(0)
		expect(console.info).toHaveBeenCalledWith('wait')
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('and is running in'))
		expect(epic_solo_stale.io.settle).not.toHaveBeenCalled()
	})
})

describe('epic:next with active local lanes without labels', () => {
	it('withholds a solo candidate beside an active local lane without an in-progress label', async () => {
		labelled_stopped()
		const current = snapshot()

		vi.mocked(epic_next_read.read_snapshots).mockResolvedValue({
			notices: [],
			reads: [
				{
					reference: { number: Number(EPIC) },
					snapshot: {
						...current,
						children: current.children.map((child) => ({
							...child,
							labels: [...child.labels, RUN_SOLO_LABEL],
						})),
					},
				},
			],
		})

		expect(await epic_next.run(ARGV)).toBe(0)
		expect(console.info).toHaveBeenCalledWith('wait')
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('and waits for'))
	})

	it('explains full local occupancy even when all labelled holders have stopped', async () => {
		labelled_stopped()
		await full_local_occupancy()

		expect(await epic_next.run(ARGV)).toBe(0)
		expect(console.info).toHaveBeenCalledWith('wait')
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(`2 of 2 lanes in use in ${REPO}`),
		)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No lane is free'))
	})
})
