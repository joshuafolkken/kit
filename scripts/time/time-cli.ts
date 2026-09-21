#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { transcript_cwd } from '#scripts/cost-runtime/transcript-cwd'
import { cost_run_report } from '#scripts/cost/cost-run-report'
import { time_run_state } from './time-run-state'
import { time_run_state_collect } from './time-run-state-collect'

// `josh time` — where a run's wall clock went, read from Claude Code's own session transcripts and,
// for the part no transcript records, from GitHub (joshuafolkken/kit#1267, joshuafolkken/kit#1268).
//
// The wall-clock sibling of `josh cost`: same files, same discovery, the other axis. Discovery and
// reading come from `cost-transcript.ts` unchanged — a second copy of the slug rule is how one of
// the two commands quietly stops finding a project's transcripts.
//
// **The only scope is the run tree** (joshuafolkken/kit#2017). The additional report scopes
// (`--epic` / `--last` / `--period` / `--session` / `--issue`) and the `--instructions` / `--top`
// modifiers they carried were retired with no rule or decision reading them; `--run` names the same
// default tree explicitly, while `--json` shapes it and `--path` redirects the read.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh time [--run] [--json] [--path <dir>]'

interface Options {
	is_json: boolean
	// The target project whose transcripts to read, or `undefined` for this process's own working
	// directory (joshuafolkken/kit#1987). From the kit checkout, `--path <dir>` points the read at
	// another project's transcripts, history and config.
	path: string | undefined
}

const PARSE_ARGS_OPTIONS = {
	json: { type: 'boolean', default: false },
	run: { type: 'boolean', default: false },
	path: { type: 'string' },
} as const

// An unknown flag is a refusal rather than a default: a misspelled or retired flag must not quietly
// report the run tree as though the mistake had been understood.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })

		return { is_json: values.json, path: values.path }
	} catch {
		return undefined
	}
}

// The run-state lead the run-tree path prepends: the run this checkout is carrying, read from the
// `run:carry` / `run:wake` records so a stopped run is surfaced at the front rather than left for the
// run-tree report to bury (joshuafolkken/kit#1939). Text only — `--json` prints the structured
// run-tree record alone.
async function run_state_lead(cwd: string, is_json: boolean): Promise<Array<string>> {
	if (is_json) return []

	const facts = await time_run_state_collect.read_facts(cwd, Date.now())

	return [...time_run_state.lead_lines(facts)]
}

// The run tree, led by the run-state block when the run has not finished. The tree report is
// `cost-run-report.ts`'s, kept for `josh time` after `josh cost`'s readerless run-tree scopes were
// retired (#2016).
async function run_tree(cwd: string, is_json: boolean): Promise<number> {
	const lead = await run_state_lead(cwd, is_json)

	return cost_run_report.run(cwd, undefined, is_json, lead)
}

// **The default is this process's own working directory.** A dispatched lane child writes its
// transcript under the lane's own slug, which is all a lane searches (joshuafolkken/kit#1749,
// joshuafolkken/kit#2236); `--path <dir>` reads the target project instead of the process cwd
// (joshuafolkken/kit#1987).
async function run(argv: ReadonlyArray<string>, cwd: string = process.cwd()): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_tree(transcript_cwd.resolve(options.path, cwd), options.is_json)
}

// `process.exitCode` rather than `process.exit()`: the report is written with `console.info`, and
// `process.exit()` tears the process down before a pipe has drained — the same idiom, for the same
// reason, as `scripts/cost-runtime/cost-cli.ts`.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const time_cli = {
	USAGE,
	parse_options,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main(process.argv.slice(ARGV_OFFSET))

export type { Options }
export { time_cli }
