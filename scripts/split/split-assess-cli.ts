#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { path_decision } from '#scripts/josh/path-decision'
import { split_assess } from './split-assess'

// `josh split:assess` — measure a branch's change size, tests excluded, and answer the size question
// of the split assessment (joshuafolkken/kit#2218).
//
// A command rather than a paragraph for the reason every decision oracle is one: the "about 10 files /
// 400 lines" guide is a number, but the size behind it was estimated by eye, so no data ever
// accumulated to test the guide against. This counts the real diff after the fact, and answers
// `split` / `single` on size alone — separability stays a judgement, said so in the reason line.
// The question and the counting live in `split-assess.ts`; everything here is the invocation.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh split:assess [--json]'
const JSON_KEY = 'split'
const FAILURE_EXIT_CODE = 1

function parse_is_json(argv: ReadonlyArray<string>): boolean | undefined {
	if (path_decision.has_unknown_flag(argv, [path_decision.JSON_FLAG])) return undefined

	return argv.includes(path_decision.JSON_FLAG)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const is_json = parse_is_json(argv)

	if (is_json === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const measurement = split_assess.assess(await git_command.diff_main_numstat())
	const reason = split_assess.reason(measurement)

	path_decision.print_decision(JSON_KEY, measurement.verdict, reason, is_json)

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const split_assess_cli = { JSON_KEY, USAGE, main, parse_is_json, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { split_assess_cli }
