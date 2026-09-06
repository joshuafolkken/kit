import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloseKind } from './lane-close'
import type { LaneInfo } from './lane-registry'

// joshuafolkken/kit#1490: `lane:open` prints the lane directory on standard output and nothing else,
// so `dir=$(pnpm josh lane:open 1490)` is what a caller needs and a refusal is an empty capture
// beside a non-zero exit. The other three follow `run:hold`'s contract: tokens on standard output,
// every explanation on standard error.

vi.mock('./lane-open', () => ({ lane_open: { open_lane: vi.fn() } }))
vi.mock('./lane-close', () => ({
	lane_close: { close_all_lanes: vi.fn(), close_lane: vi.fn(), prune_lanes: vi.fn() },
}))
vi.mock('./lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))

const { lane_open } = await import('./lane-open')
const { lane_close } = await import('./lane-close')
const { lane_registry } = await import('./lane-registry')
const { lane_cli } = await import('./lane-cli')

const ALREADY_OPEN = 'already-open'
const ISSUE = '1490'
const OTHER_ISSUE = '1491'
const SUCCESS = 0
const FAILURE = 1
const LANE: LaneInfo = {
	issue: ISSUE,
	seed: 6,
	branch: 'lane/1490',
	directory: '/w/.kit-lanes/1490',
	is_stranded: false,
}

function closes_as(kind: CloseKind, left_behind: ReadonlyArray<string> = []): void {
	vi.mocked(lane_close.close_lane).mockResolvedValue({
		issue: ISSUE,
		kind,
		left_behind: [...left_behind],
	})
}

const printed: Array<string> = []

beforeEach(() => {
	printed.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		printed.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('lane:open', () => {
	it('prints the lane directory alone, so a caller can capture it', async () => {
		vi.mocked(lane_open.open_lane).mockResolvedValue({ kind: 'opened', lane: LANE })

		expect(await lane_cli.run(['open', '1490'])).toBe(SUCCESS)
		expect(printed).toStrictEqual([LANE.directory])
	})

	it('prints nothing and exits non-zero when the lane is already open', async () => {
		vi.mocked(lane_open.open_lane).mockResolvedValue({ kind: ALREADY_OPEN, lane: LANE })

		expect(await lane_cli.run(['open', '1490'])).toBe(FAILURE)
		expect(printed).toStrictEqual([])
	})

	it('refuses anything that is not an issue number', async () => {
		expect(await lane_cli.run(['open'])).toBe(FAILURE)
		expect(await lane_cli.run(['open', 'main'])).toBe(FAILURE)
		expect(vi.mocked(lane_open.open_lane)).not.toHaveBeenCalled()
	})

	it('names the way out of each refusal', () => {
		const full = lane_cli.refusal_message({ kind: 'full' })
		const already = lane_cli.refusal_message({ kind: ALREADY_OPEN, lane: LANE })

		expect(full).toContain('josh lane:list')
		expect(already).toContain('josh lane:close 1490')
	})
})

describe('lane:close, lane:list and lane:prune', () => {
	it('prints the issue it closed', async () => {
		closes_as('closed')

		expect(await lane_cli.run(['close', ISSUE])).toBe(SUCCESS)
		expect(printed).toStrictEqual([ISSUE])
	})

	it('prints none for a lane that was never open, and does not fail', async () => {
		closes_as('none')

		expect(await lane_cli.run(['close', ISSUE])).toBe(SUCCESS)
		expect(printed).toStrictEqual([lane_cli.NONE_TOKEN])
	})

	it('closes every lane on --all', async () => {
		vi.mocked(lane_close.close_all_lanes).mockResolvedValue({
			closed: [ISSUE, OTHER_ISSUE],
			failed: [],
		})

		expect(await lane_cli.run(['close', lane_cli.ALL_FLAG])).toBe(SUCCESS)
		expect(printed).toStrictEqual([`${ISSUE}\n${OTHER_ISSUE}`])
	})

	it('lists the open lanes', async () => {
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([LANE])

		expect(await lane_cli.run(['list'])).toBe(SUCCESS)
		expect(printed[0]).toContain('#1490')
	})

	it('prunes the lanes an interruption stranded', async () => {
		vi.mocked(lane_close.prune_lanes).mockResolvedValue({ closed: [OTHER_ISSUE], failed: [] })

		expect(await lane_cli.run(['prune'])).toBe(SUCCESS)
		expect(printed).toStrictEqual([OTHER_ISSUE])
	})
})

describe('a close that did not finish', () => {
	// Reported as a success, a close that left a branch behind sends the caller to the next
	// `lane:open`, which then fails on git's own message about a branch that already exists.
	it('exits non-zero and names what a close left behind', async () => {
		closes_as('incomplete', ['lane/1490'])

		expect(await lane_cli.run(['close', ISSUE])).toBe(FAILURE)
	})

	// A sweep that failed on one lane has closed the rest, and the caller has to know which.
	it('still prints the lanes a failed sweep did close, and exits non-zero', async () => {
		vi.mocked(lane_close.close_all_lanes).mockResolvedValue({
			closed: [OTHER_ISSUE],
			failed: [ISSUE],
		})

		expect(await lane_cli.run(['close', lane_cli.ALL_FLAG])).toBe(FAILURE)
		expect(printed).toStrictEqual([OTHER_ISSUE])
	})
})

describe('an empty listing', () => {
	it('prints the none token, not prose, on standard output when nothing is open', async () => {
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([])

		expect(await lane_cli.run(['list'])).toBe(SUCCESS)
		expect(printed).toStrictEqual([lane_cli.NONE_TOKEN])
	})
})

describe('anything else', () => {
	it('prints the usage for an unknown verb and for no verb at all', async () => {
		expect(await lane_cli.run([])).toBe(FAILURE)
		expect(await lane_cli.run(['reopen'])).toBe(FAILURE)
		expect(lane_cli.USAGE).toContain('josh lane:open')
	})

	// A caller capturing standard output must not be handed a stack trace instead of a path.
	it('reports a git failure and exits non-zero rather than throwing', async () => {
		vi.mocked(lane_open.open_lane).mockRejectedValue(new Error('not a git repository'))

		expect(await lane_cli.run(['open', '1490'])).toBe(FAILURE)
		expect(printed).toStrictEqual([])
	})
})
