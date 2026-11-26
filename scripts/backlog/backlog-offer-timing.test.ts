import { describe, expect, it } from 'vitest'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_offer_timing } from './backlog-offer-timing'

const NOW_MS = 1000
const INTERVAL_MS = 60_000

describe('backlog_offer_timing', () => {
	it.each([
		[undefined, undefined, undefined],
		[undefined, NOW_MS, undefined],
		[NOW_MS, undefined, NOW_MS],
		[NOW_MS, NOW_MS + 1, NOW_MS],
		[NOW_MS + 1, NOW_MS, NOW_MS],
	])('chooses the earlier dated or idle boundary (%s, %s)', (date, idle, expected) => {
		const state = { ...backlog_drive_fixture.state(), not_before_ms: date, idle_until_ms: idle }

		expect(backlog_offer_timing.deadline_of(state)).toBe(expected)
	})

	it('uses the deadline instead of the interval when one is present', () => {
		expect(backlog_offer_timing.due_ms(NOW_MS, 0, INTERVAL_MS)).toBe(NOW_MS)
		expect(backlog_offer_timing.due_ms(undefined, NOW_MS, INTERVAL_MS)).toBe(NOW_MS + INTERVAL_MS)
	})

	it.each([NOW_MS, NOW_MS - 1])(
		'falls back to the interval once the last ask reached deadline %s',
		(deadline) => {
			expect(backlog_offer_timing.due_ms(deadline, NOW_MS, INTERVAL_MS)).toBe(NOW_MS + INTERVAL_MS)
		},
	)

	it.each([
		[undefined, INTERVAL_MS],
		[NOW_MS + 1, 1],
		[NOW_MS + INTERVAL_MS + 1, INTERVAL_MS],
	])('bounds the local wait for deadline %s', (deadline, expected) => {
		expect(backlog_offer_timing.sleep_ms(deadline, INTERVAL_MS, NOW_MS)).toBe(expected)
	})

	it.each([NOW_MS, NOW_MS - 1])(
		'waits the full interval once deadline %s has passed',
		(deadline) => {
			expect(backlog_offer_timing.sleep_ms(deadline, INTERVAL_MS, NOW_MS)).toBe(INTERVAL_MS)
		},
	)
})

describe('backlog_offer_timing.interval_of', () => {
	const { CONFIG, FIRST_CHILD, state } = backlog_drive_fixture

	it.each([
		['no lane and a named issue left', [], true, CONFIG.idle_offer_ms],
		['no lane and nothing named left', [], false, CONFIG.offer_ms],
		['a lane and a named issue left', [FIRST_CHILD], true, CONFIG.offer_ms],
		['a lane and nothing named left', [FIRST_CHILD], false, CONFIG.offer_ms],
	])('asks at the matching interval with %s', (_label, in_flight, is_named_left, expected) => {
		expect(backlog_offer_timing.interval_of(state(in_flight), CONFIG, is_named_left)).toBe(expected)
	})
})

// joshuafolkken/kit#7583: three of six lanes ran when four issues were published to the listing.
describe('backlog_offer_timing.is_due — a waiting driver with free lanes', () => {
	const { CONFIG, harness, state } = backlog_drive_fixture
	const RUNNING = ['7571', '7572', '7573']
	const FREE_LANES = 3

	async function is_due_at(now_ms: number, is_changed: boolean): Promise<boolean> {
		const { ports } = harness({})
		const due_ports = {
			...ports,
			free_lanes: async (): Promise<number> => FREE_LANES,
			listing_changed: async (): Promise<boolean> => is_changed,
		}
		const run = {
			...backlog_offer_timing.first_run(state(RUNNING), 0),
			offered_ms: 0,
			checked_ms: 0,
		}

		return await backlog_offer_timing.is_due(run, CONFIG, due_ports, now_ms)
	}

	it('asks at the first check after the listing changed, before the interval', async () => {
		expect(CONFIG.check_ms).toBeLessThan(CONFIG.offer_ms)
		await expect(is_due_at(CONFIG.check_ms, true)).resolves.toBe(true)
	})

	it('waits out the interval while the listing is unchanged', async () => {
		await expect(is_due_at(CONFIG.check_ms, false)).resolves.toBe(false)
	})
})

// joshuafolkken/kit#8855: a run seeded with an earlier run's children asks nothing until they settle.
describe('backlog_offer_timing.is_due — a settling run', () => {
	const { CONFIG, harness, state } = backlog_drive_fixture
	const SETTLED_MS = 30_000

	async function is_due_at(now_ms: number): Promise<boolean> {
		const { ports } = harness({})
		const due_ports = { ...ports, listing_changed: async (): Promise<boolean> => true }
		const settling = { ...state(['8750']), settling_until_ms: SETTLED_MS, not_before_ms: 0 }

		return await backlog_offer_timing.is_due(
			backlog_offer_timing.first_run(settling, 0),
			CONFIG,
			due_ports,
			now_ms,
		)
	}

	it.each([
		['before the window ends, a deadline and a changed listing notwithstanding', 0, false],
		['one millisecond before the window ends', SETTLED_MS - 1, false],
		['once the window ends', SETTLED_MS, true],
	])('asks %s', async (_label, now_ms, expected) => {
		await expect(is_due_at(now_ms)).resolves.toBe(expected)
	})

	it.each([
		[undefined, false],
		[NOW_MS + 1, true],
		[NOW_MS, false],
	])('reads settling_until_ms %s as settling: %s', (until, expected) => {
		const settling = { ...state(), settling_until_ms: until }

		expect(backlog_offer_timing.is_settling(settling, NOW_MS)).toBe(expected)
	})
})
