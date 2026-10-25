import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { review_record_cli } from './review-record-cli'

// joshuafolkken/kit#4850: `review:record` printed only the line count, so a lane child reopened
// `run:review` for a round 2 the ship ran again. A lane child's code round the ship reuses now names
// the ship next; one the ship would review again does not, as `--check` tells the lane to run it.

const { reusable_mock } = vi.hoisted(() => ({ reusable_mock: vi.fn() }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: {
		REUSE: { AGAIN: 'again', DELTA: 'delta', HELD: 'held' },
		reuse_here: reusable_mock,
	},
}))
vi.mock('./review-comment-round', () => ({ review_comment_round: { carry: async () => 0 } }))
vi.mock('./review-reviewed-tree', () => ({ review_reviewed_tree: { record: vi.fn() } }))
// The real probe reads this checkout's branch; `review-record-cli-push.test.ts` owns the pushed case.
vi.mock('#scripts/run/ship/run-ship-probe', () => ({
	run_ship_probe: { is_pushed_clean: vi.fn().mockResolvedValue(false) },
}))
vi.mock('./review-record-interaction', async (original) => {
	const { review_record_interaction } =
		await original<Record<'review_record_interaction', object>>()

	return { review_record_interaction: { ...review_record_interaction, report_due: vi.fn() } }
})

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-handover-'))
const NOW = new Date('2026-10-25T00:00:00Z')
const ISSUE = 4850
const SHIP_STEP = 'pnpm josh ship --detach --review'

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function lane_child(is_child: boolean): void {
	vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(is_child ? String(ISSUE) : undefined)
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(is_child)
}

async function record_output(argv: ReadonlyArray<string>): Promise<{ code: number; out: string }> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const code = await review_record_cli.run(['--issue', String(ISSUE), ...argv], NOW, TEST_DIR)
	const out = info.mock.calls.map((call) => String(call[0])).join('\n')

	info.mockRestore()

	return { code, out }
}

describe('review_record_cli.run — the next step after a lane child records round 1', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		reusable_mock.mockReset()
	})

	it('names the ship as the next step for a lane child whose round the ship reuses', async () => {
		lane_child(true)
		reusable_mock.mockResolvedValue('held')
		const { code, out } = await record_output([])

		expect(code).toBe(0)
		expect(out).toContain('Recorded 1 review-finding line(s)')
		expect(out).toContain(SHIP_STEP)
		expect(reusable_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('prints no ship step for a round the ship would review again', async () => {
		lane_child(true)
		reusable_mock.mockResolvedValue('again')
		const { out } = await record_output([])

		expect(out).not.toContain(SHIP_STEP)
	})

	it('prints no ship step outside a lane child', async () => {
		lane_child(false)
		reusable_mock.mockResolvedValue('held')
		const { out } = await record_output([])

		expect(out).not.toContain(SHIP_STEP)
	})

	it('prints no ship step for the interaction pass', async () => {
		lane_child(true)
		reusable_mock.mockResolvedValue('held')
		const { out } = await record_output(['--interaction'])

		expect(out).not.toContain(SHIP_STEP)
	})
})
