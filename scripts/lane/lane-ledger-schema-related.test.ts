import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7639: a `test:related` row carries the files the cap left at their whole reach.

const ROW = {
	kind: 'test-related',
	at: '2026-11-16T00:00:00.000Z',
	scope: 'related',
	changed: 3,
	synced: 0,
	since_map: 0,
	readers: 1,
	over_cap: 2,
	over_cap_hub: 'scripts/hub.ts',
	elapsed_ms: 1000,
}

// joshuafolkken/kit#7976: a row counts what the cap deferred to CI; an older one, read above, has none.
describe('lane_ledger_schema_related — the deferred count', () => {
	it('reads a row with its deferred count back as written', () => {
		const row = { ...ROW, deferred: 12 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})
})

// joshuafolkken/kit#8893: a row lists the test files the cap deferred; an older one counts them alone.
describe('lane_ledger_schema_related — the deferred files', () => {
	it('reads a row with its deferred files back as written', () => {
		const row = { ...ROW, deferred: 2, deferred_files: ['scripts/a.test.ts', 'scripts/b.test.ts'] }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row written before the deferred files, by its count alone', () => {
		const parsed = lane_ledger_schema.entry_schema.parse({ ...ROW, deferred: 12 })

		expect(parsed).toMatchObject({ deferred: 12 })
		expect(parsed).not.toHaveProperty('deferred_files')
	})
})

// joshuafolkken/kit#7980: a row names how its tests were chosen; an older one, read above, does not.
describe('lane_ledger_schema_related — the selection method', () => {
	it('reads a row with its selection method back as written', () => {
		const row = { ...ROW, select_method: 'symbol' }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('refuses a selection method it does not know', () => {
		const row = { ...ROW, select_method: 'guess' }

		expect(lane_ledger_schema.entry_schema.safeParse(row).success).toBe(false)
	})
})

describe('lane_ledger_schema_related — the test:related row, read through the entry union', () => {
	it('reads a row with its full-reach files back as written', () => {
		const row = { ...ROW, full_reach: [{ file: 'scripts/wide.ts', reached: 1777 }] }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row written before the full-reach files were recorded', () => {
		expect(lane_ledger_schema.entry_schema.parse(ROW)).toEqual(ROW)
	})

	// joshuafolkken/kit#7828: the rebuild, the core wait and vitest, each timed.
	it('reads a row with its stage times back as written', () => {
		const row = { ...ROW, rebuild_ms: 4000, core_wait_ms: 1200, vitest_ms: 9000 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row that timed only some stages', () => {
		const row = { ...ROW, vitest_ms: 9000 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	// joshuafolkken/kit#7965: the tree key, the exit code, the failed files and the caller.
	it('reads a row with its tree, outcome and caller back as written', () => {
		const row = {
			...ROW,
			tree: 'f00dfeed',
			base: 'abc123',
			exit_code: 1,
			failed: ['scripts/own.test.ts'],
			caller: 'run:chain check:related',
		}

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row written before the tree, outcome and caller were recorded', () => {
		const parsed = lane_ledger_schema.entry_schema.parse(ROW)

		expect(parsed).toEqual(ROW)
		expect(parsed).not.toHaveProperty('caller')
	})
})

// joshuafolkken/kit#7827: one `josh lint:related` run, each stage timed.
describe('lane_ledger_schema_related — the lint:related row, read through the entry union', () => {
	const LINT_ROW = { kind: 'lint-related', at: ROW.at, elapsed_ms: 5500, exit_code: 0 }

	it('reads a row with every stage time back as written', () => {
		const row = {
			...LINT_ROW,
			issue: 7827,
			rebuild_ms: 4000,
			core_wait_ms: 30,
			fix_ms: 900,
			structural_ms: 1500,
			lint_ms: 2600,
			documents_ms: 40,
			unused_members_ms: 700,
		}

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row whose run stopped before the later stages', () => {
		const row = { ...LINT_ROW, exit_code: 1, fix_ms: 900, lint_ms: 2600 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('refuses a row without its exit code', () => {
		expect(() =>
			lane_ledger_schema.entry_schema.parse({ ...LINT_ROW, exit_code: undefined }),
		).toThrow()
	})
})
