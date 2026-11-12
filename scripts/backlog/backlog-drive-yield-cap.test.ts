import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_fixture, type Harness } from './backlog-drive-fixture'
import { backlog_yield_cap } from './backlog-yield-cap'

const { FIRST_CHILD, harness, offer, state } = backlog_drive_fixture
const { YIELD_CAP, WINDOW_MS } = backlog_yield_cap
const PARK = `park ${FIRST_CHILD}`
// One minute between yields, as the 2026-11-08 loop ran.
const LOOP_GAP_MS = MS_PER_MINUTE

// A child that yields on every launch, offered back each time it is collected.
function yielding_loop(rounds: number): Harness {
	return harness({
		finished: [FIRST_CHILD],
		yielded: [FIRST_CHILD],
		offers: Array.from({ length: rounds }, () => offer('run', [FIRST_CHILD])),
	})
}

function gaps_of(rounds: number): ReadonlyArray<number> {
	return Array.from({ length: rounds }, () => LOOP_GAP_MS)
}

// One pass per gap, the clock moving the gap before it; the state after the last.
async function passes(
	ports: Harness['ports'],
	gaps: ReadonlyArray<number>,
	current: DriveState = state([FIRST_CHILD]),
): Promise<DriveState> {
	const [gap, ...rest] = gaps

	if (gap === undefined) return current
	await ports.sleep(gap)
	const result = await backlog_drive.run_pass(current, true, ports)

	return await passes(ports, rest, result.state)
}

// joshuafolkken/kit#6799: a child yielding once a minute was re-dispatched without end.
describe('backlog_drive — the yield cap', () => {
	it('parks and excludes a child on its YIELD_CAP-th yield within the window', async () => {
		const run = yielding_loop(YIELD_CAP)
		const last = await passes(run.ports, gaps_of(YIELD_CAP))

		// The offer after the trip carries it in `--exclude`, so `backlog:offer` dispatches it no more.
		expect(run.calls.filter((call) => call === PARK)).toHaveLength(1)
		expect(last.exclude).toStrictEqual([FIRST_CHILD])
		expect(run.offers.at(-1)?.exclude).toStrictEqual([FIRST_CHILD])
	})

	it('leaves a child below the cap in the run, not excluded', async () => {
		const run = yielding_loop(YIELD_CAP - 1)
		const last = await passes(run.ports, gaps_of(YIELD_CAP - 1))

		expect(run.calls).not.toContain(PARK)
		expect(last.exclude).toStrictEqual([])
	})

	it('does not count a yield outside the window', async () => {
		const run = yielding_loop(YIELD_CAP)
		const late = WINDOW_MS + LOOP_GAP_MS
		const last = await passes(run.ports, [LOOP_GAP_MS, late, ...gaps_of(YIELD_CAP - 2)])

		expect(run.calls).not.toContain(PARK)
		expect(last.exclude).toStrictEqual([])
	})
})
