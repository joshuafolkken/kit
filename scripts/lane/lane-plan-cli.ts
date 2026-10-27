#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_plan_check } from './lane-plan-check'

// `josh lane:plan <issue> <path>... [--probe]` — the command line over `lane-plan-check.ts`, which holds
// the check and the yield so `run:entry` can import them without this entry's main guard.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const PROBE_FLAG = '--probe'
const USAGE = 'Usage: josh lane:plan <issue-number> <path> [<path> ...] [--probe]'
const { YIELD_EXIT_CODE } = lane_plan_check

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	const plan = lane_plan_check.plan_of(
		argv.filter((token) => token !== PROBE_FLAG),
		new Date(),
	)
	const action = argv.includes(PROBE_FLAG)
		? lane_plan_check.probe_answer
		: lane_plan_check.check_plan

	if (plan !== undefined) return await action(lane_plan_check.placed(plan, directory), directory)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_plan_cli = { USAGE, YIELD_EXIT_CODE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_plan_cli }
