#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { layer_report, type LayerReport } from './layer-report'
import { layer_sources } from './layer-sources'

// `josh layers` — which checks run in more than one verification layer (joshuafolkken/kit#1313).
//
// **It is deliberately not part of `josh time`.** That command reads session transcripts, and the
// repetition this one is about is invisible there in principle: a hook's seconds are buried inside
// `josh git`'s, and CI's appear only as a per-check duration with nothing to compare them to. The
// answer has to come from the configuration files, which is a different reading of a different
// source — epic joshuafolkken/kit#1315 records that judgement.
//
// **It reports; it changes nothing.** Which repeats are worth removing is a decision about what a
// hook should guard, and this command's job is to put the list in front of whoever makes it.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT = 2
const USAGE = 'Usage: josh layers [--json]'

interface Options {
	is_json: boolean
}

function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({
			args: [...argv],
			options: { json: { type: 'boolean' } },
			strict: true,
		})

		return { is_json: values.json === true }
	} catch {
		return undefined
	}
}

// **The checkout is the working directory, and there is deliberately no flag to point it
// elsewhere.** Reporting on another checkout was only ever a diagnostic convenience — the command's
// use is "which checks repeat in the project I am in" — and paying for it meant taking a file
// system path off the command line and handing it straight to `readdir` / `readFile`, which is a
// path traversal waiting for a wrong argument. The parameter stays on this function so the tests
// can point it at a fixture tree; nothing on the command line reaches it.
function build(root: string): LayerReport {
	return layer_report.build_report(layer_sources.read_layer_steps(root))
}

function print_report(options: Options): number {
	const report = build(process.cwd())

	if (options.is_json) {
		console.info(JSON.stringify(report, undefined, JSON_INDENT))

		return 0
	}

	console.info(layer_report.format_report(report).join('\n'))

	return 0
}

function run(argv: ReadonlyArray<string>): number {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return print_report(options)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const layers_cli = { USAGE, build, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { layers_cli }
