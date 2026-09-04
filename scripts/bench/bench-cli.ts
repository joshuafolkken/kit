#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { time_distribution } from '#scripts/time/time-distribution'
import { bench_guard } from './bench-guard'
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

async function build(options: Options, root: string): Promise<BenchReport | undefined> {
	const { targets, unknown } = bench_targets.resolve_targets(options.names)

	if (unknown.length > 0 || targets.length === 0) return undefined

	const samples = await bench_run.measure_targets(targets, options.repetitions, root)

	return bench_report.build_report(samples, bench_run.residue_notes(samples, root))
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
// consumer reading success off the exit code would take an empty report for an answer.
function exit_code_for(report: BenchReport): number {
	const measured = report.rows.filter((row) => time_distribution.is_measured(row.cold))

	return measured.length === 0 ? FAILURE_EXIT_CODE : 0
}

async function report_or_usage(options: Options): Promise<number> {
	const report = await build(options, process.cwd())

	if (report === undefined) {
		console.error(`Unknown target. ${USAGE}`)
		console.error(`Targets: ${bench_targets.BENCH_TARGETS.map((t) => t.name).join(', ')}`)

		return FAILURE_EXIT_CODE
	}

	print_report(report, options)

	return exit_code_for(report)
}

// The guard is asked again before every clearing inside `bench-run.ts`, so a gate started mid-run
// stops it there; this is the same refusal reaching the exit code rather than a stack trace.
async function guarded_report(options: Options): Promise<number> {
	try {
		return await report_or_usage(options)
	} catch (error) {
		if (!bench_guard.is_gate_running_error(error)) throw error

		console.error(bench_guard.GATE_RUNNING_MESSAGE)

		return FAILURE_EXIT_CODE
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
