import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3355: `lane:sample` appends one load sample and `lane:stats` prints the period's
// table row; a malformed verb or flag is refused rather than measured as a zero period.

const sample_mock = vi.hoisted(() => vi.fn())

vi.mock('./lane-load', () => ({ lane_load: { sample: sample_mock } }))

const { lane_ledger } = await import('./lane-ledger')
const { lane_measure_cli } = await import('./lane-measure-cli')
const { lane_stats } = await import('./lane-stats')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-measure-cli-test-'))
const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const FAILURE = 1

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function fresh_context(): { ledger_path: string; now_ms: number } {
	return { ledger_path: path.join(scratch, `${randomUUID()}.jsonl`), now_ms: NOW }
}

beforeEach(() => {
	sample_mock.mockReset().mockImplementation((at: string) => ({
		kind: 'load',
		at,
		load: 3,
		available_mb: 1024,
	}))
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

describe('lane_measure_cli.run — refusals', () => {
	it.each([
		[[]],
		[['measure']],
		[['sample', '--every', '0']],
		[['sample', '--every', 'soon']],
		[['sample', '--unknown']],
		[['stats']],
		[['stats', '--period', '-1']],
	])('refuses %j', async (argv) => {
		await expect(lane_measure_cli.run(argv, fresh_context())).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})
})

describe('lane_measure_cli.run — sample', () => {
	it('appends one load sample stamped with the current instant', async () => {
		const context = fresh_context()

		await expect(lane_measure_cli.run(['sample'], context)).resolves.toBe(0)

		expect(sample_mock).toHaveBeenCalledWith(AT)
		expect(lane_ledger.read_entries(context.ledger_path)).toStrictEqual([
			{ kind: 'load', at: AT, load: 3, available_mb: 1024 },
		])
	})
})

describe('lane_measure_cli.run — stats', () => {
	it('prints the header and the row of the ledger period under the given limit', async () => {
		const context = fresh_context()

		lane_ledger.append(context.ledger_path, { kind: 'merge', at: AT, issue: 1 })

		await expect(
			lane_measure_cli.run(['stats', '--period', '2', '--limit', '6'], context),
		).resolves.toBe(0)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed.startsWith(lane_stats.header())).toBe(true)
		expect(printed).toContain('| 6 | 2 | 1 |')
	})
})
