#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import type { LanePlan } from './lane-plan'
import { lane_plan_approval } from './lane-plan-approval'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_imports } from './lane-plan-imports'

// `josh lane:plan <issue> <path>... [--probe] [--imports <path>...]` — the command line over
// `lane-plan-check.ts`, which holds the check and the yield so `run:entry` can import them without this
// entry's main guard; `--imports` probes the modules the new code imports (`lane-plan-imports.ts`).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const PROBE_FLAG = '--probe'
const USAGE =
	'Usage: josh lane:plan <issue-number> <path> [<path> ...] [--probe] [--size-approval <json-file>] [--imports <path> ...]'
const { YIELD_EXIT_CODE } = lane_plan_check

async function planned(
	tokens: ReadonlyArray<string>,
	directory: string,
): Promise<LanePlan | undefined> {
	const input = lane_plan_approval.split(tokens)
	const plan = lane_plan_check.plan_of(input.tokens, new Date())
	if (plan === undefined) return undefined

	return await lane_plan_approval.attach(lane_plan_check.placed(plan, directory), input.file)
}

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	const { plan: tokens, imports } = lane_plan_imports.split(
		argv.filter((token) => token !== PROBE_FLAG),
	)
	const plan = await planned(tokens, directory)

	if (plan === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const action = argv.includes(PROBE_FLAG)
		? lane_plan_check.probe_answer
		: lane_plan_check.check_plan
	const code = await action(plan, directory)

	lane_plan_imports.report(String(plan.issue), imports, directory)

	return code
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_plan_cli = { USAGE, YIELD_EXIT_CODE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_plan_cli }
