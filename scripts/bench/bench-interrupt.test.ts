import { describe, expect, it } from 'vitest'
import { bench_interrupt, type MeasurementInput } from './bench-interrupt'
import { bench_report, type BenchSample } from './bench-report'

const LINT = 'lint'
const CHECK = 'check'
const CSPELL = 'cspell:dot'
const UNIT = 'test:unit'
const ESLINT_CACHE = '.eslintcache'
const SECOND = 1000

function sample(target: string, cycles: number): BenchSample {
	return {
		target,
		caches: [ESLINT_CACHE],
		readings: Array.from({ length: cycles }, () => ({
			cold_ms: 4 * SECOND,
			warm_ms: SECOND,
			is_failed: false,
		})),
	}
}

function input(overrides: Partial<MeasurementInput> = {}): MeasurementInput {
	return {
		target_names: [LINT, CHECK, CSPELL, UNIT],
		taken: [sample(LINT, 1), sample(CHECK, 1)],
		repetitions: 1,
		is_interrupted: true,
		...overrides,
	}
}

// The readings taken before the gate started were taken on a tree nothing else was running on, so
// the abort's rationale does not reach them — which is the whole of joshuafolkken/kit#1369.
describe('bench interrupt — the readings a stopped run keeps', () => {
	it('keeps the sample of every target it finished', () => {
		const { samples } = bench_interrupt.assemble(input())
		const finished = samples.filter((one) => one.readings.length > 0)

		expect(finished.map((one) => one.target)).toStrictEqual([LINT, CHECK])
	})

	// Never silently dropped and never rendered as a zero: the target the run never reached is a row
	// saying so, beside the rows that were measured.
	it('stands an empty sample in for every target it never reached', () => {
		const { samples } = bench_interrupt.assemble(input())

		expect(samples.map((one) => one.target)).toStrictEqual([LINT, CHECK, CSPELL, UNIT])
		expect(samples.at(-1)?.readings).toStrictEqual([])
	})

	// A target that took no reading cleared no cache, so claiming one would send `residue_notes` after
	// a warm run that never started.
	it('clears no cache on behalf of a target it never reached', () => {
		const { samples } = bench_interrupt.assemble(input())

		expect(samples.at(-1)?.caches).toStrictEqual([])
	})

	// `josh bench lint lint` is two targets and two independent samples. Identified by name, both rows
	// would resolve to whichever was stored last — the empty one — and the completed reading beside it
	// would be discarded in exactly the case this module exists to keep.
	it('keeps both samples where the same target was named twice', () => {
		const repeated = input({
			target_names: [LINT, LINT, CHECK],
			taken: [sample(LINT, 1), sample(LINT, 0)],
		})
		const { samples } = bench_interrupt.assemble(repeated)

		expect(samples.map((one) => one.readings.length)).toStrictEqual([1, 0, 0])
	})

	it('adds nothing at all to a run that finished every target', () => {
		const complete = input({
			target_names: [LINT, CHECK],
			taken: [sample(LINT, 1), sample(CHECK, 1)],
			is_interrupted: false,
		})

		expect(bench_interrupt.assemble(complete).notes).toStrictEqual([])
	})
})

describe('bench interrupt — what the table then says', () => {
	it('renders the target it never reached as not measured', () => {
		const { samples, notes } = bench_interrupt.assemble(input())
		const rendered = bench_report.format_report(bench_report.build_report(samples, notes, true))

		expect(rendered.join('\n')).toContain('not measured')
	})

	it('says how many commands it did measure, not how many it was asked for', () => {
		const { samples } = bench_interrupt.assemble(input())

		expect(bench_report.measured_count(bench_report.build_report(samples))).toBe(2)
	})
})

describe('bench interrupt — what the note says', () => {
	it('says the run was interrupted and by what', () => {
		const [note] = bench_interrupt.assemble(input()).notes

		expect(note).toContain(bench_interrupt.INTERRUPTED_PREFIX)
	})

	it('names every target it did not finish', () => {
		const [note] = bench_interrupt.assemble(input()).notes

		expect(note).toContain(`${CSPELL} 0 of 1`)
		expect(note).toContain(`${UNIT} 0 of 1`)
	})

	it('leaves the targets it finished out of the note', () => {
		const [note] = bench_interrupt.assemble(input()).notes

		expect(note).not.toContain(`${LINT} `)
	})

	// A `--repeat 3` cut off after one cycle is as unfinished as a target never started, and without
	// the count its row is indistinguishable from a deliberate `--repeat 1`.
	it('counts the cycles a partly measured target managed', () => {
		const partial = input({ taken: [sample(LINT, 1)], repetitions: 3 })

		expect(bench_interrupt.shortfall(sample(LINT, 1), 3)).toBe(`${LINT} 1 of 3`)
		expect(bench_interrupt.assemble(partial).notes.join('')).toContain(`${LINT} 1 of 3`)
	})

	it('says nothing about a target that took every cycle it was asked for', () => {
		expect(bench_interrupt.shortfall(sample(LINT, 3), 3)).toBeUndefined()
	})

	// A claimed interruption is reported even where nothing is short of its cycles, rather than
	// rendered as a note trailing an empty list.
	it('reports the interruption on its own where every target is complete', () => {
		const complete = input({ target_names: [LINT], taken: [sample(LINT, 1)] })

		expect(bench_interrupt.assemble(complete).notes).toStrictEqual([
			bench_interrupt.INTERRUPTED_PREFIX,
		])
	})
})
