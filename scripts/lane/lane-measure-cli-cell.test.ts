import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'

// joshuafolkken/kit#5144: `josh lane:value cell` prints any cell of a table `lane:stats` prints, by its
// table title, row and column, as the one number a measurement declaration reads.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-measure-cli-cell-test-'))
const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const SINCE = '2026-10-06T00:00Z'
const FAILURE = 1
const STAGE = 'review'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

function fresh_context(): {
	ledger_path: string
	events_path: string
	transcript_directories: Array<string>
	now_ms: number
} {
	return {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
		transcript_directories: [],
		now_ms: NOW,
	}
}

describe('lane_measure_cli.run — value cell', () => {
	const address = ['--table', 'stage', '--row', STAGE, '--column', 'median (min)']
	const argv = ['value', 'cell', '--since', SINCE, ...address]

	it('prints the cell the lane:stats table holds, two decimals', async () => {
		const context = fresh_context()
		const ninety_seconds = 90_000

		lane_ledger_write.append(context.ledger_path, {
			kind: 'stage',
			at: AT,
			stage: STAGE,
			elapsed_ms: ninety_seconds,
		})

		await expect(lane_measure_cli.run(argv, context)).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('1.50')
	})

	it('fails with no value when the period holds no sample for the cell', async () => {
		await expect(lane_measure_cli.run(argv, fresh_context())).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('no single numeric cell since'),
		)
	})

	it.each([
		[['--table', 'stage', '--row', STAGE]],
		[['--row', STAGE, '--column', 'runs']],
		[['--table', 'stage', '--column', 'runs']],
	])('refuses a partial address %j', async (partial) => {
		const refused = ['value', 'cell', '--since', SINCE, ...partial]

		await expect(lane_measure_cli.run(refused, fresh_context())).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})

	it('names the cell address in the usage it prints', () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:value cell --table <title> --row <label>')
	})
})
