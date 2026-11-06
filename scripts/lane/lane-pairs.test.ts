import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import type { LedgerEntry, ShipLapEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'
import { lane_pairs } from './lane-pairs'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6189: the period's scoped pair laps by named-file count and split-failure reason,
// and its capped `josh test:related` runs by hub, each row's runs and minutes.

const MINUTE_MS = 60_000
const START = Date.parse('2026-11-01T00:00:00.000Z')
const WINDOW = { since_ms: START, until_ms: START + 100 * MINUTE_MS }
const HUB = 'scripts/josh/josh-aliases.ts'
const NO_GRAPH = 'no import graph could be built'
const UNRESOLVED = 'the work tree holds a file TypeScript does not resolve'

const scratch = make_directory('lane-pairs-test-')

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function pair_lap(
	minute: number,
	minutes: number,
	note: Partial<Pick<ShipLapEntry, 'named' | 'unsplit' | 'step'>>,
): ShipLapEntry {
	return {
		kind: 'ship-lap',
		at: at(minute),
		issue: 1,
		stage: 'gate',
		step: 'scoped pair',
		elapsed_ms: minutes * MINUTE_MS,
		...note,
	}
}

function related_run(minute: number, minutes: number, hub: string | undefined): LedgerEntry {
	return {
		kind: 'test-related',
		at: at(minute),
		issue: 1,
		scope: 'branch',
		changed: 3,
		synced: 0,
		since_map: 0,
		readers: 1,
		over_cap: hub === undefined ? undefined : 1,
		over_cap_hub: hub,
		elapsed_ms: minutes * MINUTE_MS,
	}
}

const ENTRIES: ReadonlyArray<LedgerEntry> = [
	pair_lap(1, 2, { named: 12 }),
	pair_lap(2, 3, { named: 40 }),
	pair_lap(3, 10, { named: 1200 }),
	pair_lap(4, 6, { unsplit: NO_GRAPH }),
	pair_lap(5, 8, { unsplit: `${UNRESOLVED}: src/app.d.ts` }),
	pair_lap(6, 1, {}),
	pair_lap(7, 9, { named: 5, step: 'josh gate' }),
	related_run(8, 4, HUB),
	related_run(9, 5, HUB),
	related_run(10, 7, 'scripts/lib/cli-flags.ts'),
	related_run(11, 2, undefined),
	pair_lap(200, 30, { named: 3 }),
]

describe('lane_pairs.table', () => {
	const rows = lane_pairs.table(ENTRIES, WINDOW).split('\n')

	it('heads the table with its columns', () => {
		expect(rows[0]).toBe('| group | row | runs | total min |')
	})

	it('counts the named runs per size bucket in size order, an empty bucket at zero', () => {
		expect(rows.slice(2, 5)).toStrictEqual([
			'| named files | <50 | 2 | 5.0 |',
			'| named files | 50-1000 | 0 | 0.0 |',
			'| named files | >1000 | 1 | 10.0 |',
		])
	})

	it('groups the split failures by reason, the detail dropped, the longest first', () => {
		expect(rows.slice(5, 7)).toStrictEqual([
			`| unsplit | ${UNRESOLVED} | 1 | 8.0 |`,
			`| unsplit | ${NO_GRAPH} | 1 | 6.0 |`,
		])
	})

	it('sums the capped runs per hub, the longest first', () => {
		expect(rows.slice(7)).toStrictEqual([
			`| over-cap hub | ${HUB} | 2 | 9.0 |`,
			'| over-cap hub | scripts/lib/cli-flags.ts | 1 | 7.0 |',
		])
	})
})

describe('lane_measure_cli.run — stats --pairs', () => {
	it('names the pairs form in the usage it prints', () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:stats --period <days> --pairs')
	})

	it('prints the pairs table read from the ledger', async () => {
		vi.spyOn(console, 'info').mockReturnValue(undefined)
		const context = {
			ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
			events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
			transcript_directories: [],
			now_ms: START + 100 * MINUTE_MS,
		}

		for (const entry of ENTRIES) lane_ledger_write.append(context.ledger_path, entry)

		await expect(
			lane_measure_cli.run(['stats', '--period', '1', '--pairs'], context),
		).resolves.toBe(0)
		expect(String(vi.mocked(console.info).mock.calls[0]?.[0])).toContain(
			`| over-cap hub | ${HUB} | 2 | 9.0 |`,
		)
	})
})
