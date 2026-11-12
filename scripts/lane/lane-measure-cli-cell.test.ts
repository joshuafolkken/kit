import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5144: `josh lane:value cell` prints any cell of a table `lane:stats` prints, by its
// table title, row and column, as the one number a measurement declaration reads.

const scratch = make_directory('lane-measure-cli-cell-test-')
const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const AT = new Date(NOW).toISOString()
const SINCE = '2026-10-06T00:00Z'
const FAILURE = 1
const STAGE = 'review'
const MEDIAN = 'median (min)'

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

// A context whose ledger holds one `review` stage, the `stage` table's only row.
function staged_context(): ReturnType<typeof fresh_context> {
	const context = fresh_context()
	const ninety_seconds = 90_000

	lane_ledger_write.append(context.ledger_path, {
		kind: 'stage',
		at: AT,
		stage: STAGE,
		elapsed_ms: ninety_seconds,
	})

	return context
}

describe('lane_measure_cli.run — value cell', () => {
	const address = ['--table', 'stage', '--row', STAGE, '--column', MEDIAN]
	const argv = ['value', 'cell', '--since', SINCE, ...address]

	it('prints the cell the lane:stats table holds, two decimals', async () => {
		await expect(lane_measure_cli.run(argv, staged_context())).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('1.50')
	})

	it('fails with no value when the period holds no sample for the cell', async () => {
		await expect(lane_measure_cli.run(argv, fresh_context())).resolves.toBe(FAILURE)
		expect(console.info).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no numeric cell since'))
	})

	it.each([
		[['--table', 'stage', '--row', STAGE]],
		[['--row', STAGE, '--column', 'runs']],
		[['--table', 'stage', '--column', 'runs', '--where', STAGE]],
		[['--table', 'stage', '--column', 'runs', '--where', `=${STAGE}`]],
	])('refuses a partial or malformed address %j', async (partial) => {
		const refused = ['value', 'cell', '--since', SINCE, ...partial]

		await expect(lane_measure_cli.run(refused, fresh_context())).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})

	it('names the cell address in the usage it prints', () => {
		expect(lane_measure_cli.USAGE).toContain(
			'josh lane:value cell --table <title> [--row <label>] [--where <header>=<text>]',
		)
	})
})

// joshuafolkken/kit#5947: `--where` picks the row by a column's text in place of `--row`.
describe('lane_measure_cli.run — value cell --where', () => {
	it('reads the row a --where filter names', async () => {
		const where = ['--table', 'stage', '--where', `stage=${STAGE}`, '--column', MEDIAN]
		const filtered = ['value', 'cell', '--since', SINCE, ...where]

		await expect(lane_measure_cli.run(filtered, staged_context())).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('1.50')
	})

	it('reads a row --where misses as 0 under --zero', async () => {
		const where = ['--table', 'stage', '--where', 'stage=gate', '--column', 'runs', '--zero']
		const filtered = ['value', 'cell', '--since', SINCE, ...where]

		await expect(lane_measure_cli.run(filtered, staged_context())).resolves.toBe(0)
		expect(console.info).toHaveBeenCalledWith('0.00')
	})
})
