import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it, vi } from 'vitest'
import { fanout } from './fanout'
import { fanout_cli } from './fanout-cli'

// joshuafolkken/kit#2345: whether the Step 0 change list may be cut into units and dispatched in one
// fan-out turn is decided by one mechanical test — are the units' file sets disjoint? Two subagents
// editing one file in parallel race on it, so a shared file forces serial, and fewer than two units
// is nothing to parallelize. The default is serial, the same direction `josh delegate` defaults to
// keep.

const UNIT_A = 'scripts/a.ts,scripts/a.test.ts'
const UNIT_B = 'scripts/b.ts,scripts/b.test.ts'
const UNIT_C = 'docs/c.md'

describe('fanout.fanout_result', () => {
	it('runs disjoint units in parallel', () => {
		const result = fanout.fanout_result([{ files: ['a.ts'] }, { files: ['b.ts'] }])

		expect(result.verdict).toBe(fanout.PARALLEL_VERDICT)
		expect(result.overlaps).toStrictEqual([])
	})

	// A shared file is the one failure parallelism adds: the split is refused and the collision named.
	it('keeps units that share a file serial', () => {
		const result = fanout.fanout_result([
			{ files: ['a.ts', 'shared.ts'] },
			{ files: ['b.ts', 'shared.ts'] },
		])

		expect(result.verdict).toBe(fanout.SERIAL_VERDICT)
		expect(result.overlaps).toStrictEqual(['shared.ts'])
		expect(result.reason).toContain('shared.ts')
	})

	// The default is serial: one unit is nothing to run in parallel, and neither is none.
	it.each([[[]], [[{ files: ['a.ts'] }]]])('keeps fewer than two units serial', (units) => {
		expect(fanout.fanout_result(units).verdict).toBe(fanout.SERIAL_VERDICT)
	})

	// A file listed twice inside one unit is not an overlap with anyone else.
	it('does not count a repeat within one unit as an overlap', () => {
		const result = fanout.fanout_result([{ files: ['a.ts', 'a.ts'] }, { files: ['b.ts'] }])

		expect(result.verdict).toBe(fanout.PARALLEL_VERDICT)
	})

	// Every shared file is reported, sorted, so a person reading the reason sees all the collisions.
	it('reports every shared file, sorted', () => {
		const result = fanout.fanout_result([{ files: ['z.ts', 'a.ts'] }, { files: ['a.ts', 'z.ts'] }])

		expect(result.overlaps).toStrictEqual(['a.ts', 'z.ts'])
	})
})

// What a call writes to stdout, captured rather than reconstructed: the verdict is what a shell reads.
function captured_info(act: () => void): Array<string> {
	const written: Array<string> = []
	const info_spy = vi.spyOn(console, 'info').mockImplementation((line: string) => {
		written.push(line)
	})
	const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		act()
	} finally {
		info_spy.mockRestore()
		error_spy.mockRestore()
	}

	return written
}

describe('fanout_cli.run', () => {
	it('answers parallel for disjoint units on stdout', () => {
		const written = captured_info(() => {
			expect(fanout_cli.run([UNIT_A, UNIT_B, UNIT_C])).toBe(0)
		})

		expect(written).toStrictEqual([fanout.PARALLEL_VERDICT])
	})

	it('answers serial when two units share a file', () => {
		const written = captured_info(() => {
			expect(fanout_cli.run([UNIT_A, `${UNIT_B},scripts/a.ts`])).toBe(0)
		})

		expect(written).toStrictEqual([fanout.SERIAL_VERDICT])
	})

	// One unit is nothing to fan out, so the verdict is serial rather than a refusal.
	it('answers serial for a single unit', () => {
		const written = captured_info(() => {
			expect(fanout_cli.run([UNIT_A])).toBe(0)
		})

		expect(written).toStrictEqual([fanout.SERIAL_VERDICT])
	})

	// No argument, or a unit that parses to no files, is a typo rather than a verdict.
	it.each([[[]], [['']], [[',']], [[UNIT_A, '']]])('refuses %j rather than guessing', (argv) => {
		expect(fanout_cli.run(argv)).toBe(1)
	})
})

describe('fanout_cli.parse_unit', () => {
	it('splits a comma list and trims each file', () => {
		expect(fanout_cli.parse_unit(' a.ts , b.ts ').files).toStrictEqual(['a.ts', 'b.ts'])
	})

	it('drops the empties a stray comma leaves', () => {
		expect(fanout_cli.parse_unit('a.ts,,b.ts,').files).toStrictEqual(['a.ts', 'b.ts'])
	})
})

describe('josh fanout registration', () => {
	it('is registered as a josh command', () => {
		const { fanout: entry } = COMMAND_MAP

		expect(entry?.script).toBe('scripts/delegation/fanout-cli.ts')
	})

	it('has a short alias', () => {
		const { fo } = ALIASES

		expect(fo).toBe('fanout')
	})
})
