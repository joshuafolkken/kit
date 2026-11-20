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
const create_directory = temporary_directory()

function at(minute: number): string {
	return new Date(minute * MS_PER_MINUTE).toISOString()
}

function lines_of(issue: number, offset: number): Array<object> {
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

// Three lanes merged at minutes 40, 140 and 340, read with "now" a day in.
function source(): Source {
	const ledger = path.join(create_directory('lane-phases-'), 'ledger.jsonl')
	const lines = [...lines_of(1, 0), ...lines_of(2, 100), ...lines_of(3, 300)]

	writeFileSync(ledger, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)

	return {
		ledger_path: async () => await ledger,
		events: async () => [],
		now_ms: () => MINUTES_PER_DAY * MS_PER_MINUTE,
	}
}

async function printed(argv: ReadonlyArray<string>): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	expect(await lane_phases_cli.run(argv, source())).toBe(0)

	return String(info.mock.calls.at(0)?.at(0))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_phases_cli.run', () => {
	it('reads the named Issues, with or without their # lead', async () => {
		const text = await printed(['#1', '2'])

		expect(text).toContain(TWO_LANES)
		expect(text).toContain('- push → merge: 40.0 min median / 2 lanes')
	})

	it('reads the lanes merged inside --since and --until', async () => {
		expect(await printed([SINCE, at(100), '--until', at(200)])).toContain('over 1 lanes')
	})

	it('reads up to now when --until is left out', async () => {
		expect(await printed([SINCE, at(100)])).toContain(TWO_LANES)
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
