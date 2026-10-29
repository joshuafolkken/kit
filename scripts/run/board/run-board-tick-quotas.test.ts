import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather_live } from './run-board-gather-live'
import type { Quotas } from './run-board-quota-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#5395: the usage-limit readings are read with the machine sample and drawn in the
// ⛽ usage section right under the header.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const QUOTAS: Quotas = {
	claude: { windows: [{ minutes: 300, used_percent: 42, resets_ms: 0 }], taken_ms: 0 },
	codex: undefined,
}

describe('run_board_tick.tick quotas', () => {
	it.each(['claude', 'codex'] as const)(
		'draws the recorded %s scheduler in expanded and folded usage',
		async (scheduler_provider) => {
			const { ports, frames, gathering } = harness({ ...LOCAL, scheduler_provider }, [
				plan_titled('a'),
			])

			gathering.read_quotas = vi.fn(async () => QUOTAS)
			await tick(FRESH_STATE, ports)
			expect(frames.join('\n')).toContain(`🤖 ${scheduler_provider}`)
			ports.folded = () => new Set(['usage'])
			await tick(FRESH_STATE, ports)
			expect(frames.at(-1)).toContain(`▸ ⛽ usage`)
			expect(frames.at(-1)).toContain(`🤖 ${scheduler_provider}`)
			expect(frames.join('\n')).toContain('🤖 scheduler')
		},
	)

	it('reads the quotas with the machine sample and draws the usage section', async () => {
		const { ports, frames, gathering } = harness(LOCAL, [plan_titled('a')])
		const read_quotas = vi.fn(async () => QUOTAS)

		gathering.read_quotas = read_quotas
		const state = await tick(FRESH_STATE, ports)

		expect(read_quotas).toHaveBeenCalledOnce()
		expect(state.quotas).toStrictEqual(QUOTAS)
		expect(frames.join('\n')).toContain('⛽ usage')
	})

	it('draws no usage section where the board is given no reader', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		const state = await tick(FRESH_STATE, ports)

		expect(state.quotas).toBeUndefined()
		expect(frames.join('\n')).not.toContain('⛽ usage')
	})
})

describe('run_board_gather_live.ports_of quotas', () => {
	it('gives the live board a quota reader', () => {
		expect(run_board_gather_live.ports_of(true).read_quotas).toBeTypeOf('function')
	})
})
