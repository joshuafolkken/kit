import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_read } from './run-board-usage-read'

// joshuafolkken/kit#4359: an `lsof` cut short — killed on its budget or by a signal — may end on a
// directory missing its tail, `.kit-lanes/43` for `.kit-lanes/4346`, so its last answer is not taken.

const MAIN = '/Users/me/Development/kit'
const ROOT = lane_paths.lane_root(MAIN)
const START = 'Tue Oct 20 08:39:04 2026'
const TABLE = vi.fn(async () =>
	lane_process_table.parse(`5 7 0:01 4 S ${START} node\n1 7 0:01 4 S ${START} eslint`),
)
const LSOF_GONE_EXIT_CODE = 1

interface LsofEnd {
	isTerminated: boolean
	failed: boolean
	exitCode: number | undefined
}

const lsof: LsofEnd = { isTerminated: true, failed: true, exitCode: undefined }

vi.mock('execa', () => ({
	execa: vi.fn(async (file: string) =>
		file === 'lsof'
			? { stdout: `p5\nn${ROOT}/4346\np1\nn${ROOT}/43`, ...lsof }
			: { stdout: '', isTerminated: false, failed: false, exitCode: 0 },
	),
}))

afterEach(() => {
	vi.restoreAllMocks()
})

interface LaneRead {
	lane: string | undefined
	unread: boolean
}

async function read_lanes(end: LsofEnd, pid = 1): Promise<LaneRead> {
	Object.assign(lsof, end)
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(MAIN)

	const mark = await run_board_usage_read.usage_reader('darwin')(undefined, TABLE)

	return { lane: mark?.lanes.get(pid), unread: mark?.unread.has(pid) ?? false }
}

describe('run_board_usage_read.usage_reader against an lsof cut short', () => {
	const killed = { isTerminated: true, failed: true, exitCode: undefined }

	it('takes no last answer, and leaves its process to ask again', async () => {
		await expect(read_lanes(killed)).resolves.toStrictEqual({ lane: undefined, unread: true })
	})

	it('takes the whole answers before the last', async () => {
		await expect(read_lanes(killed, 5)).resolves.toStrictEqual({ lane: '4346', unread: false })
	})

	it('leaves the process to ask again when lsof never started', async () => {
		const end = { isTerminated: false, failed: true, exitCode: undefined }

		await expect(read_lanes(end)).resolves.toStrictEqual({ lane: undefined, unread: true })
	})

	it('takes the answers of an lsof that ran to its end, a non-zero exit included', async () => {
		const finished = { isTerminated: false, failed: false, exitCode: 0 }
		const gone = { isTerminated: false, failed: true, exitCode: LSOF_GONE_EXIT_CODE }

		await expect(read_lanes(finished)).resolves.toStrictEqual({ lane: '43', unread: false })
		await expect(read_lanes(gone)).resolves.toStrictEqual({ lane: '43', unread: false })
	})
})
