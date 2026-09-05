#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bench_guard } from './bench-guard'
import { bench_interrupt } from './bench-interrupt'
import { bench_report, type BenchReport } from './bench-report'
import { bench_run } from './bench-run'
import { bench_targets } from './bench-targets'

// `josh bench` — what a verification command costs cold, and what it costs warm
// (joshuafolkken/kit#1314).
//
// **It is deliberately not part of `josh time`.** That command reads session transcripts and reports
// what a past run took; this one runs the command again, twice, and the difference between the two
// readings exists nowhere in a transcript. Epic joshuafolkken/kit#1315 records that judgement, and
// `josh layers` (joshuafolkken/kit#1313) was split out of `josh time` on the same one.
//
// **It measures; it changes nothing that survives the run.** The only files it removes are the
// gate's own cache files, every one of them git-ignored, and the warm run rewrites each one before
// the command exits.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const DEFAULT_REPETITIONS = 1
const MAX_REPETITIONS = 9
const USAGE = `Usage: josh bench [<target>…] [--repeat <1-${String(MAX_REPETITIONS)}>] [--json]`

interface Options {
	is_json: boolean
	repetitions: number
	names: ReadonlyArray<string>
}

function parse_repetitions(raw: string | undefined): number | undefined {
	if (raw === undefined) return DEFAULT_REPETITIONS

	const parsed = Number(raw)

	if (!Number.isSafeInteger(parsed) || parsed < DEFAULT_REPETITIONS || parsed > MAX_REPETITIONS) {
		return undefined
	}

	return parsed
}

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values, positionals } = parseArgs({
			args: [...argv],
			options: { json: { type: 'boolean' }, repeat: { type: 'string' } },
			allowPositionals: true,
			strict: true,
		})
		const repetitions = parse_repetitions(values.repeat)

		if (repetitions === undefined) return undefined

		return { is_json: values.json === true, repetitions, names: positionals }
	} catch {
		return undefined
	}
}

// **The interruption note goes in front of the residue one**, because it is what explains the rest of
// the report: rows that are missing, and caches a warm run never reached.
async function build(options: Options, root: string): Promise<BenchReport | undefined> {
	const { targets, unknown } = bench_targets.resolve_targets(options.names)

	if (unknown.length > 0 || targets.length === 0) return undefined

	const measured = await bench_run.measure_targets(targets, options.repetitions, root)
	const { samples, notes } = bench_interrupt.assemble({
		target_names: targets.map((target) => target.name),
		taken: measured.samples,
		repetitions: options.repetitions,
		is_interrupted: measured.is_interrupted,
	})

	return bench_report.build_report(
		samples,
		[...notes, ...bench_run.residue_notes(samples, root)],
		measured.is_interrupted,
	)
}

function print_report(report: BenchReport, options: Options): void {
	if (options.is_json) {
		console.info(JSON.stringify(report, undefined, JSON_INDENT))

		return
	}

	console.info(bench_report.format_report(report).join('\n'))
}

// **A report of nothing but `not measured` rows exits non-zero.** The command's whole product is the
// figures, so a run that produced none has failed at what it was asked to do — and a `--json`
// consumer reading success off the exit code would take an empty report for an answer. The count is
// the report's own, so the exit code and the heading cannot come to disagree about what was measured.
//
// **An interruption outranks that count** (joshuafolkken/kit#1369). Both are non-zero, so nothing
// that only asks whether the run finished changes; what the third value adds is *why* it did not, and
// a gate holding the caches is the one answer worth retrying later. A run a gate stopped before its
// first reading is that case too — the reason it measured nothing is known and said in the note.
function exit_code_for(report: BenchReport): number {
	if (report.is_interrupted) return bench_interrupt.INTERRUPTED_EXIT_CODE

	return bench_report.measured_count(report) === 0 ? FAILURE_EXIT_CODE : 0
}

// The refusal is repeated on stderr because the report itself goes to stdout, `--json` included: the
// note says which targets were left, and this says what to do about it.
async function report_or_usage(options: Options): Promise<number> {
	const report = await build(options, process.cwd())

	if (report === undefined) {
		console.error(`Unknown target. ${USAGE}`)
		console.error(`Targets: ${bench_targets.BENCH_TARGETS.map((t) => t.name).join(', ')}`)

		return FAILURE_EXIT_CODE
	}

	print_report(report, options)

	if (report.is_interrupted) console.error(bench_guard.GATE_RUNNING_MESSAGE)

	return exit_code_for(report)
}

// The backstop. `bench-run.ts` catches the refusal at the reading that raised it and keeps everything
// measured before it, so this is reached only by a future call site that raises the same error
// outside that loop — and a refusal reaching the exit code is still better than a stack trace.
async function guarded_report(options: Options): Promise<number> {
	try {
		return await report_or_usage(options)
	} catch (error) {
		if (!bench_guard.is_gate_running_error(error)) throw error

		console.error(bench_guard.GATE_RUNNING_MESSAGE)

		return bench_interrupt.INTERRUPTED_EXIT_CODE
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await guarded_report(options)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const bench_cli = { build, exit_code_for, main, MAX_REPETITIONS, parse_options, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { bench_cli }
