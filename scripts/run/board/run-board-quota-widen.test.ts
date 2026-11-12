import { describe, expect, it, vi } from 'vitest'
import { run_board_quota_held, type QuotaPorts } from './run-board-quota-held'
import { run_board_quota_read, type QuotaReading } from './run-board-quota-read'
import { run_board_render_quota } from './run-board-render-quota'

// The 2026-11-02 11:24 board (joshuafolkken/kit#5826): the sample's newest ten lanes read 41–45%,
// but one of them was resumed and its head still holds its first launch's 25%, taken while 90 lanes
// were yet to finish. Its rise is theirs, not the sample's ten.
const { quota_reader } = run_board_quota_held
const { FILES_SCANNED, SCAN_FACTOR } = run_board_quota_read
const SEVEN_DAYS = 10_080
const MINUTE_MS = 60_000
const NOW_MS = new Date(2026, 10, 2, 11, 24).getTime()
const RESETS_MS = NOW_MS + 3 * 24 * 60 * MINUTE_MS
const STEP_MS = 6 * MINUTE_MS
const LANES = 100
const RESUMED = 8
const FIRST_LAUNCH = 90
const NEWEST_USED = 45
const RISE_PER_LANE = 0.2
const FIRST_USED = 25
const CODEX_LANE = 20

function lane_of(path: string): number {
	return Number(path.replace('lane-', ''))
}

function used_at(lane: number): QuotaReading {
	return {
		windows: [
			{
				minutes: SEVEN_DAYS,
				used_percent: NEWEST_USED - lane * RISE_PER_LANE,
				resets_ms: RESETS_MS,
			},
		],
		taken_ms: NOW_MS - lane * STEP_MS,
	}
}

// Each lane's head reads where the lane before it ended; the resumed one's, its first launch.
function head_of(lane: number): QuotaReading {
	if (lane !== RESUMED) return used_at(lane + 1)

	const first = used_at(FIRST_LAUNCH)

	return {
		...first,
		windows: first.windows.map((window) => ({ ...window, used_percent: FIRST_USED })),
	}
}

// A source that filters each page can return short pages without exhausting its wider results.
function ports_of(
	limits: Array<number>,
	dropped: ReadonlyArray<number> = [],
): QuotaPorts & { read_tail: ReturnType<typeof vi.fn> } {
	const files = Array.from({ length: LANES }, (_, lane) => ({
		path: `lane-${String(lane)}`,
		mtime_ms: LANES - lane,
	}))
	const claude = {
		find: async (limit: number) => {
			limits.push(limit)

			return files.slice(0, limit).filter((file) => !dropped.includes(lane_of(file.path)))
		},
		reading_of: (text: string) => used_at(lane_of(text)),
		heads_of: (text: string) => [head_of(lane_of(text))],
		is_done: () => true,
	}
	const codex = { ...claude, find: async () => [] }
	const read_tail = vi.fn(async (file: string): Promise<string> => file)
	const read_head = vi.fn(async (file: string): Promise<string> => file)

	return { sources: { claude, codex }, read_tail, read_head, now: () => NOW_MS }
}

describe('run_board_quota_held.quota_reader — the lanes done across the rise', () => {
	it("shares a resumed lane's rise by the lanes done since its first launch, ≈N over 100", async () => {
		const { claude } = await quota_reader(ports_of([]))()
		const summary = run_board_render_quota.usage_part({
			quotas: { claude, codex: undefined },
			now_ms: NOW_MS,
		})?.summary

		expect(claude?.per_task?.[SEVEN_DAYS]).toBeCloseTo((NEWEST_USED - FIRST_USED) / FIRST_LAUNCH)
		expect(summary).toContain(' ≈247 ')
	})

	it('widens the list until a lane ended before the oldest reading, reading no further', async () => {
		const limits: Array<number> = []
		const ports = ports_of(limits)

		await quota_reader(ports)()

		const widest = FILES_SCANNED * SCAN_FACTOR * SCAN_FACTOR

		expect(limits).toEqual([FILES_SCANNED, FILES_SCANNED, FILES_SCANNED * SCAN_FACTOR, widest])
		expect(ports.read_tail).toHaveBeenCalledTimes(FIRST_LAUNCH + 2)
	})

	it('widens a page a left-out Codex log shortened, as more files are listed past it', async () => {
		const limits: Array<number> = []
		const { claude } = await quota_reader(ports_of(limits, [CODEX_LANE]))()
		const widest = FILES_SCANNED * SCAN_FACTOR * SCAN_FACTOR

		expect(limits).toEqual([FILES_SCANNED, FILES_SCANNED, FILES_SCANNED * SCAN_FACTOR, widest])
		expect(claude?.per_task?.[SEVEN_DAYS]).toBeCloseTo(
			(NEWEST_USED - FIRST_USED) / (FIRST_LAUNCH - 1),
		)
	})
})
