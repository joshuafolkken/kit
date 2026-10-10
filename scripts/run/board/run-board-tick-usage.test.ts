import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_tick } from './run-board-tick'
import type { UsageMark } from './run-board-usage'

// joshuafolkken/kit#3489: each lane's usage is read on the machine's second against the last reading,
// for a chat as for a screen.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, MACHINE_SAMPLE_MS, tick } = run_board_tick
const LANE = 3423

function reading(at_ms: number, cpu_ms: number): UsageMark {
	return {
		at_ms,
		processes: new Map([[1, { cpu_ms, rss_bytes: 100 }]]),
		lanes: new Map([[1, String(LANE)]]),
		parents: new Map(),
		folded: new Set(),
		cores: 1,
		total_bytes: 1000,
	}
}

describe('run_board_tick.tick usage', () => {
	it('reads the lanes’ usage each second against the last reading', async () => {
		const { ports, read_usage, clock } = harness(LOCAL, [plan_titled('a')])
		const first = reading(0, 0)

		read_usage.mockResolvedValueOnce(first).mockResolvedValueOnce(reading(MACHINE_SAMPLE_MS, 500))
		const state = await tick(FRESH_STATE, ports)

		clock.now_ms += MACHINE_SAMPLE_MS
		const next = await tick(state, ports)

		expect(read_usage.mock.calls).toStrictEqual([[undefined], [first]])
		expect(state.usages?.get(LANE)?.cpu_percent).toBeUndefined()
		expect(next.usages?.get(LANE)?.cpu_percent).toBe(50)
	})

	it('reads the usage for a chat, which draws the column a screen does', async () => {
		const { ports, read_usage } = harness(LOCAL, [plan_titled('a')])

		read_usage.mockResolvedValueOnce(reading(0, 0))
		const state = await tick(FRESH_STATE, { ...ports, form: 'chat' })

		expect(read_usage).toHaveBeenCalledOnce()
		expect(state.usages).toBeDefined()
	})
})
