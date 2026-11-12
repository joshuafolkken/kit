import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7038: `lane:stats` and `lane:net` read the records a rotation moved into the
// archive, so a period or a lane past the retention measures as it did before the rotation.

const scratch = make_directory('lane-measure-cli-history-test-')
const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const MS_PER_DAY = 86_400_000
const ARCHIVED_DAYS = 20
const ARCHIVED_AT = new Date(NOW - ARCHIVED_DAYS * MS_PER_DAY).toISOString()
const MINUTE_MS = 60_000
const ISSUE = 6788
const NET_MINUTES = 21

interface TestContext {
	ledger_path: string
	events_path: string
	transcript_directories: Array<string>
	now_ms: number
}

function fresh_context(): TestContext {
	return {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
		transcript_directories: [],
		now_ms: NOW,
	}
}

function archive(context: { ledger_path: string }, entry: object): void {
	lane_ledger_write.append(lane_ledger_archive.archive_of(context.ledger_path), entry)
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

describe('lane_measure_cli.run — the archive past the retention', () => {
	it('counts a stage only the archive holds in the lane:stats table', async () => {
		const context = fresh_context()

		archive(context, { kind: 'stage', at: ARCHIVED_AT, stage: 'review', elapsed_ms: MINUTE_MS })

		await lane_measure_cli.run(['stats', '--period', '30'], context)

		expect(String(vi.mocked(console.info).mock.calls[0]?.[0])).toContain(
			'| review | 1.0 | 1.0 | 1 |',
		)
	})

	it('reads a lane whose dispatch only the archive holds for lane:net', async () => {
		const context = fresh_context()
		const merged_at = Date.parse(ARCHIVED_AT) + NET_MINUTES * MINUTE_MS

		archive(context, { kind: 'dispatch', at: ARCHIVED_AT, issue: ISSUE })
		lane_ledger_write.append(context.ledger_path, {
			kind: 'merge',
			at: new Date(merged_at).toISOString(),
			issue: ISSUE,
		})

		await expect(lane_measure_cli.run(['net', String(ISSUE)], context)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith(String(NET_MINUTES))
	})
})
