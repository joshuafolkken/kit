import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_phases_cli, type Source } from './lane-phases-cli'

// joshuafolkken/kit#8287: `josh lane:phases` takes named Issues or a `--since` / `--until` period and
// reads the ledger file it is pointed at.

const MERGED_MINUTE = 40
const SHIP_MINUTES = 2
const MINUTES_PER_DAY = 1440
const SINCE = '--since'
const TWO_LANES = 'over 2 lanes'
const TWO_SHIPS = '- push → merge: 40.0 min median / 2 lanes'
const create_directory = temporary_directory()

function at(minute: number): string {
	return new Date(minute * MS_PER_MINUTE).toISOString()
}

function lines_of(issue: number, offset: number): [object, object, object] {
	return [
		{ kind: 'dispatch', at: at(offset), issue },
		{
			kind: 'chain',
			at: at(offset + SHIP_MINUTES),
			issue,
			elapsed_ms: SHIP_MINUTES * MS_PER_MINUTE,
			join: true,
			stages: [{ name: 'ship', at: at(offset), elapsed_ms: SHIP_MINUTES * MS_PER_MINUTE }],
		},
		{ kind: 'merge', at: at(offset + MERGED_MINUTE), issue },
	]
}

function write(file: string, lines: ReadonlyArray<object>): void {
	writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
}

// Three lanes merged at minutes 40, 140 and 340, read with "now" a day in. `rotated` moves lane 1's
// rows but its merge into the archive beside the ledger, as rotation does.
function source(rotated = false): Source {
	const directory = create_directory('lane-phases-')
	const ledger = path.join(directory, 'ledger.jsonl')
	const [dispatch, chain, merge] = lines_of(1, 0)
	const first = rotated ? [merge] : [dispatch, chain, merge]

	if (rotated) write(path.join(directory, 'ledger-archive.jsonl'), [dispatch, chain])
	write(ledger, [...first, ...lines_of(2, 100), ...lines_of(3, 300)])

	return {
		ledger_path: async () => await ledger,
		events: async () => [],
		now_ms: () => MINUTES_PER_DAY * MS_PER_MINUTE,
	}
}

async function printed(argv: ReadonlyArray<string>, rotated = false): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	expect(await lane_phases_cli.run(argv, source(rotated))).toBe(0)

	return String(info.mock.calls.at(0)?.at(0))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_phases_cli.run', () => {
	it('reads the named Issues, with or without their # lead', async () => {
		const text = await printed(['#1', '2'])

		expect(text).toContain(TWO_LANES)
		expect(text).toContain(TWO_SHIPS)
	})

	it('reads a named Issue whose rows rotation moved into the archive', async () => {
		expect(await printed(['#1', '2'], true)).toContain(TWO_SHIPS)
	})

	it('reads the lanes merged inside --since and --until', async () => {
		expect(await printed([SINCE, at(100), '--until', at(200)])).toContain('over 1 lanes')
	})

	it('reads up to now when --until is left out', async () => {
		expect(await printed([SINCE, at(100)])).toContain(TWO_LANES)
	})

	it('prints the run:chain stage and josh ship step tables after the phases', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await lane_phases_cli.run(['#1'], source())).toBe(0)
		expect(String(info.mock.calls.at(1)?.at(0))).toMatch(
			/^run:chain stages: .*\njosh ship steps: /u,
		)
	})

	it('prints the usage for a malformed request', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const requests = [[], ['abc'], [SINCE, 'never'], [SINCE, at(0), '--to', at(1)]]
		const codes = await Promise.all(
			requests.map(async (argv) => await lane_phases_cli.run(argv, source())),
		)

		expect(codes).toEqual([1, 1, 1, 1])
		expect(error).toHaveBeenCalledWith(lane_phases_cli.USAGE)
	})
})
