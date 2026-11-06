import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_early_push_stats } from './lane-early-push-stats'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_stats } from './lane-stats'
import { lane_stats_tables } from './lane-stats-tables'

const make_directory = temporary_directory('suite')

const NOW = Date.parse('2026-11-04T12:00:00Z')
const WINDOW = lane_stats.window_of(1, NOW)
const scratch = make_directory('early-push-')
const SOURCE = 'review'
const REASON = 'dirty-tree'
const KIND = 'early-push'

describe('lane early push decisions', () => {
	it('roundtrips skip reasons through the ledger into lane:stats', async () => {
		const target = path.join(scratch, 'ledger.jsonl')

		await lane_ledger_write.record_early_push(
			{ source: SOURCE, result: REASON, issue: 6251 },
			target,
		)
		const entries = lane_ledger.read_entries(target)
		const tables = lane_stats_tables.tables_of(
			{ entries, events: [], calls: [] },
			lane_stats.window_of(1, Date.now()),
		)

		expect(entries).toMatchObject([{ kind: KIND, source: SOURCE, result: REASON, issue: 6251 }])
		expect(tables.join('\n')).toContain('| review | dirty-tree | 1 |')
	})

	it('counts by source and result within the requested period', () => {
		const entry: LedgerEntry = {
			kind: KIND,
			at: new Date(NOW).toISOString(),
			source: 'ship',
			result: 'pushed',
		}
		const old = { ...entry, at: '2026-10-01T00:00:00Z' }
		const table = lane_early_push_stats.table([entry, entry, old], WINDOW)

		expect(table).toContain('| ship | pushed | 2 |')
	})
})
