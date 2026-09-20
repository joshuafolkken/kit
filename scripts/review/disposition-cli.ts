#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { disposition } from './disposition-logic'

// `josh disposition <path...>` — the machine half of the three-way review disposition
// (joshuafolkken/kit#2181). It prints `runtime` when any named path reaches a runtime path — a
// runtime code path, a distributed artifact a consumer reads, or the verification guarding either —
// and `non-runtime` when every path is inert. `prompts/review.md` → "Three-way disposition after the
// cap" leaves the run one judgement after this: whether the finding is a confirmed defect.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh disposition <path...>'
const FAILURE_EXIT_CODE = 1

function reason_line(paths: ReadonlyArray<string>): string {
	const reaching = disposition.reaching_paths(paths)

	return reaching.length === 0
		? 'every path is inert — the finding cannot escape this repository'
		: `reaches through: ${reaching.join(', ')}`
}

function run(argv: ReadonlyArray<string>): number {
	if (argv.length === 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	process.stdout.write(`${disposition.disposition_for(argv)}\n`)
	process.stderr.write(`${reason_line(argv)}\n`)

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const disposition_cli = { USAGE, main, reason_line, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { disposition_cli }
