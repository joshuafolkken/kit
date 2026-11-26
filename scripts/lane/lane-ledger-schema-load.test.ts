import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7244: a load sample's process kinds carry the footprint, compressed pages included.

const AT = '2026-11-11T00:00:00.000Z'

function load_with(process_kind: Record<string, unknown>): Record<string, unknown> {
	return { kind: 'load', at: AT, load: 4, processes: [process_kind] }
}

describe('lane_ledger_schema_load — the load sample, read through the entry union', () => {
	it('reads a process kind with its footprint back as written', () => {
		const load = load_with({
			kind: 'eslint',
			cpu_percent: 0,
			rss_mb: 52,
			footprint_mb: 1619,
			count: 1,
		})

		expect(lane_ledger_schema.entry_schema.parse(load)).toEqual(load)
	})

	it('reads a row written before the footprint was recorded', () => {
		const load = load_with({ kind: 'eslint', cpu_percent: 0, rss_mb: 52, count: 1 })

		expect(lane_ledger_schema.entry_schema.parse(load)).toEqual(load)
	})

	// joshuafolkken/kit#9000: the core count and the budget's admitted claims by command.
	it('reads the core count and the reserved cores back as written', () => {
		const load = {
			kind: 'load',
			at: AT,
			load: 12,
			cores: 11,
			reserved: [{ command: 'x', cores: 2 }],
		}

		expect(lane_ledger_schema.entry_schema.parse(load)).toEqual(load)
	})
})
