import type { BenchSample } from './bench-report'

// What a `josh bench` run a gate interrupted still owes the reader (joshuafolkken/kit#1369).
//
// **The abort itself is correct and stays.** Clearing a cache a running `josh gate` is reading is
// joshuafolkken/kit#1332 from the other side, and a reading taken while the two compete for the same
// cores measures neither of them.
//
// **That rationale does not reach backwards.** The readings taken *before* the gate started were
// taken on a tree nothing else was running on, so they are as valid as any other — and the default
// set is minutes long, so discarding them made the user pay the whole wall clock again because a
// pre-commit hook started a gate thirty seconds ago.
//
// **Nothing here runs a command.** The assembly is a pure function of samples already taken, which is
// what the acceptance criterion's unit tests are written against: execution is one child process per
// reading, and a suite that spawned them would measure the machine it ran on.

// **Interruption is its own exit code, inside the family `josh time` already uses.** `0` means every
// target the command was asked for was measured; `1` keeps the meaning it has everywhere in this
// package — the measurement itself produced nothing usable, which is where joshuafolkken/kit#1352 put
// a report whose rows could not be built; and this third value says the figures above it are real but
// incomplete. A caller that only asks "did this finish?" still reads non-zero exactly as before, and
// one that would retry later can tell an interruption from a red check without parsing the report.
const INTERRUPTED_EXIT_CODE = 2

const INTERRUPTED_PREFIX = 'interrupted by josh gate starting on this tree'

interface Measurement {
	// Every target the run was asked for, in the order it was asked for them: the samples it took,
	// and an empty one standing in for each target it never reached.
	samples: ReadonlyArray<BenchSample>
	notes: ReadonlyArray<string>
}

interface MeasurementInput {
	target_names: ReadonlyArray<string>
	taken: ReadonlyArray<BenchSample>
	repetitions: number
	is_interrupted: boolean
}

// **A target the run never reached is a row, not an absence.** It renders as `not measured` beside
// the rows that were taken, which is this epic's standing answer: what could not be measured is
// reported as such, never silently dropped and never rendered as a zero. `caches` is empty because
// nothing was cleared for it — carrying the target's declared list would claim a cold reading that
// was never taken, and `residue_notes` would then report a cache the warm run was never asked to
// rebuild.
function empty_sample(target: string): BenchSample {
	return { target, caches: [], readings: [] }
}

// **Positional, never keyed by target name.** The command line is not de-duplicated — `josh bench
// lint lint` is two targets and two independent samples — so a map keyed by name would resolve both
// rows to whichever was stored last. Where the second one is the target a gate stopped, that is the
// empty sample, and the completed multi-minute reading beside it would be discarded in exactly the
// case this module exists to keep. The samples arrive in target order and stop where the run
// stopped, so the index is what identifies them.
function pad_samples(input: MeasurementInput): Array<BenchSample> {
	return input.target_names.map((name, index) => input.taken[index] ?? empty_sample(name))
}

// `<target> <taken> of <asked>` for every target short of the cycles it was asked for. **Zero and a
// partial count are one list rather than two**, because they are one fact — the run stopped before it
// finished this target — and a `--repeat 3` cut off after one cycle is exactly as unfinished as a
// target never started. Saying so is what keeps a shortened row from reading like a `--repeat 1` run.
function shortfall(sample: BenchSample, repetitions: number): string | undefined {
	if (sample.readings.length >= repetitions) return undefined

	return `${sample.target} ${String(sample.readings.length)} of ${String(repetitions)}`
}

// **The note carries both facts the abort used to leave unsaid**: that the run was interrupted, and
// which targets it did not finish. The bare prefix is the answer where every target happens to be
// complete — a caller's claim of an interruption is reported rather than rendered as an empty list.
function interruption_note(samples: ReadonlyArray<BenchSample>, repetitions: number): string {
	const unfinished = samples
		.map((sample) => shortfall(sample, repetitions))
		.filter((entry) => entry !== undefined)

	if (unfinished.length === 0) return INTERRUPTED_PREFIX

	return `${INTERRUPTED_PREFIX}; cycles not finished: ${unfinished.join(', ')}`
}

function assemble(input: MeasurementInput): Measurement {
	const samples = pad_samples(input)

	if (!input.is_interrupted) return { samples, notes: [] }

	return { samples, notes: [interruption_note(samples, input.repetitions)] }
}

const bench_interrupt = {
	INTERRUPTED_EXIT_CODE,
	INTERRUPTED_PREFIX,
	assemble,
	interruption_note,
	shortfall,
}

export type { Measurement, MeasurementInput }
export { bench_interrupt }
