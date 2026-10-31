#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { disposition_batch } from './disposition-batch'
import { disposition_batch_filing } from './disposition-batch-filing'
import { disposition } from './disposition-logic'

// `josh disposition <path...>` — the machine half of the three-way review disposition.
// It prints `runtime` when any named path reaches a runtime path — a
// runtime code path, a distributed artifact a consumer reads, or the verification guarding either —
// and `non-runtime` when every path is inert. `prompts/review.md` → "Three-way disposition after the
// cap" leaves the run one judgement after this: whether the finding is a confirmed defect.
// `--batch <findings-file>` routes every remaining finding at once (`disposition-batch.ts`).

const ARGV_OFFSET = 2
const BATCH_FLAG = '--batch'
const USAGE = 'Usage: josh disposition <path...> | --batch <findings-file>'
const FAILURE_EXIT_CODE = 1

function reason_line(paths: ReadonlyArray<string>): string {
	const reaching = disposition.reaching_paths(paths)

	return reaching.length === 0
		? 'every path is inert — the finding cannot escape this repository'
		: `reaches through: ${reaching.join(', ')}`
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

// `<findings-file> [--found-during <N>]`; the issue is needed once a finding routes to `file`.
function run_batch(argv: ReadonlyArray<string>): number {
	const [path] = argv

	if (path === undefined) return refuse(USAGE)

	const result = disposition_batch.parse(readFileSync(path, 'utf8'))

	if ('invalid' in result) {
		return refuse(`not in the review:record grammar:\n${result.invalid.join('\n')}`)
	}

	const filing = disposition_batch_filing.filing_lines(result.findings, argv)

	if (filing === undefined) return refuse(disposition_batch_filing.MISSING_FOUND_DURING)

	process.stdout.write(`${[disposition_batch.render(result.findings), ...filing].join('\n')}\n`)

	return 0
}

function run(argv: ReadonlyArray<string>): number {
	if (argv[0] === BATCH_FLAG) return run_batch(argv.slice(1))

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

const disposition_cli = { USAGE, reason_line, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { disposition_cli }
