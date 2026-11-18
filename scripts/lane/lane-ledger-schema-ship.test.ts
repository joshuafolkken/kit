import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

const AT = '2026-10-28T00:00:00.000Z'
const LAP = {
	kind: 'ship-lap',
	at: AT,
	issue: 5294,
	stage: 'gate',
	step: 'josh gate',
	elapsed_ms: 1200,
}
const SCOPED_PAIR = 'scoped pair'

// joshuafolkken/kit#7736: a chain line with its stages, and an older one without them.
describe('lane_ledger_schema_ship — the run:chain line', () => {
	it.each([
		['with its stages', { stages: [{ name: 'check:related', at: AT, elapsed_ms: 900 }] }],
		['without stages', {}],
	])('reads a run:chain line %s back as written', (_label, stages) => {
		const chain = { kind: 'chain', at: AT, issue: 7736, elapsed_ms: 1200, join: false, ...stages }

		expect(lane_ledger_schema.entry_schema.parse(chain)).toEqual(chain)
	})
})

// joshuafolkken/kit#7789: a scoped pair lap says whether it resumed from the round-2 fix.
describe('lane_ledger_schema_ship — the scoped pair lap', () => {
	const PAIR = { ...LAP, step: SCOPED_PAIR }

	it.each(['round-2-fix', 'none'])(
		'keeps a scoped pair lap resumed from %s (ac-2b9687b7)',
		(resumed_from) => {
			const pair = { ...PAIR, resumed_from }

			expect(lane_ledger_schema.entry_schema.parse(pair)).toEqual(pair)
		},
	)

	it('refuses an unknown resume origin', () => {
		const pair = { ...PAIR, resumed_from: 'round-1' }

		expect(lane_ledger_schema.entry_schema.safeParse(pair).success).toBe(false)
	})
})

describe('lane_ledger_schema_ship — the lines josh ship writes, read through the entry union', () => {
	it('reads a size measurement back through the ledger union', () => {
		const size = {
			kind: 'size',
			at: AT,
			issue: 5384,
			declared: { files: 7, lines: 160 },
			actual: { files: 12, lines: 300 },
		}

		expect(lane_ledger_schema.entry_schema.parse(size)).toEqual(size)
	})

	it('reads a ship lap back as written', () => {
		expect(lane_ledger_schema.entry_schema.parse(LAP)).toEqual(LAP)
	})

	it('keeps a scoped test replay when reading the ledger', () => {
		const reused = { ...LAP, step: 'test:related', is_reused: true }

		expect(lane_ledger_schema.entry_schema.parse(reused)).toEqual(reused)
	})

	it('refuses a ship lap with no step', () => {
		const missing = { ...LAP, step: undefined }

		expect(lane_ledger_schema.entry_schema.safeParse(missing).success).toBe(false)
	})

	it('reads a ship stop back as written', () => {
		const stop = { kind: 'stop', at: AT, issue: 5294, reason: 'gate', cause: 'check' }

		expect(lane_ledger_schema.entry_schema.parse(stop)).toEqual(stop)
	})

	it('keeps the base a review failure stopped on', () => {
		const stop = { kind: 'stop', at: AT, issue: 6141, reason: 'review', base: 'a'.repeat(40) }

		expect(lane_ledger_schema.entry_schema.parse(stop)).toEqual(stop)
	})
})

// joshuafolkken/kit#7788: which condition named the scoped pair's files.
describe('lane_ledger_schema_ship — the scoped pair breakdown', () => {
	it('reads a ship lap with its scope breakdown back as written (ac-490219c5)', () => {
		const breakdown = { both: 0, unsplit: 0, read_by_tests: 3, shared: 587, lint_meeting: 5 }
		const scoped = { ...LAP, step: SCOPED_PAIR, named: 5, breakdown }

		expect(lane_ledger_schema.entry_schema.parse(scoped)).toEqual(scoped)
	})
})

// joshuafolkken/kit#7874: each preflight evaluation, passed or stopped, beside the older stop lines.
describe('lane_ledger_schema_ship — the preflight evaluation line', () => {
	const EVALUATED = ['classification', 'lock', 'scoped']

	it.each([
		['a pass', []],
		['a stop', ['lock']],
	])('reads the evaluation of %s back as written', (_name, unmet) => {
		const preflight = { kind: 'preflight', at: AT, issue: 7874, evaluated: EVALUATED, unmet }

		expect(lane_ledger_schema.entry_schema.parse(preflight)).toEqual(preflight)
	})

	it('reads a stop written before evaluations were recorded, its kinds unchanged', () => {
		const stop = { kind: 'stop', at: AT, issue: 4166, reason: 'preflight', preconditions: ['lock'] }

		expect(lane_ledger_schema.entry_schema.parse(stop)).toEqual(stop)
	})

	it('refuses an evaluation with no unmet list', () => {
		const partial = { kind: 'preflight', at: AT, issue: 7874, evaluated: EVALUATED }

		expect(lane_ledger_schema.entry_schema.safeParse(partial).success).toBe(false)
	})
})

describe('lane_ledger_schema_ship — the early-push line', () => {
	it.each([
		['with its head and slot count', { head: 'a'.repeat(40), slots: 2 }],
		['recorded before it had them', {}],
	])('reads an early push %s back as written', (_name, fields) => {
		const push = { kind: 'early-push', at: AT, source: 'review', result: 'pushed', ...fields }

		expect(lane_ledger_schema.entry_schema.parse(push)).toEqual(push)
	})
})
