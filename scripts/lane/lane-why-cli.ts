#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { run_ship_probe } from '#scripts/run/ship/run-ship-probe'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_net_read } from './lane-net-read'
import { lane_sinks_issues } from './lane-sinks-issues'
import { lane_why, type WhyRecords } from './lane-why'
import { lane_why_ci } from './lane-why-ci'
import { lane_why_ship } from './lane-why-ship'

// `josh lane:why <issue>` — a merged lane's stages over budget, each beside its causes
// (joshuafolkken/kit#6120).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:why <issue>'

// The ship log's last launch, the source of the ship's cause keys (joshuafolkken/kit#6679).
async function read_log(issue: number): Promise<string | undefined> {
	const repository = await run_ship_probe.repository_directory()

	return repository === undefined ? undefined : run_ship_detach.read_log(repository, String(issue))
}

async function records_of(issue: number): Promise<WhyRecords | undefined> {
	const { entries, events } = await lane_net_read.read_records({})
	const breakdown = lane_breakdown_implement.breakdown_of(entries, events, issue)

	if (breakdown === undefined) return undefined

	const body = await git_gh_issue_read.issue_get_body(String(issue))
	const { implement_rate, growth } = await lane_net_read.measurements()
	const projected = lane_why.projected_of(body, implement_rate, growth)

	const [issues, timing, log] = await Promise.all([
		lane_sinks_issues.read(),
		lane_why_ci.read(issue),
		read_log(issue),
	])

	return { issue, entries, events, breakdown, projected, issues, timing, log }
}

async function print(issue: string): Promise<number> {
	const lane = session_cite.issue(issue)
	const records = await records_of(Number(issue))

	if (records === undefined) {
		console.error(`josh lane:why ${issue}: the ledger holds no dispatch and merge of ${lane}`)

		return FAILURE_EXIT_CODE
	}

	console.info(lane_why.table(records) ?? `No stage of ${lane} ran over its budget.`)
	// A blank line keeps the two tables apart where the output is pasted as Markdown.
	console.info(`\n${lane_why_ship.table(records)}`)

	return 0
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [issue = ''] = argv

	if (argv.length === 1 && issue_number_shape.is_issue_number(issue)) return await print(issue)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_why_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_why_cli }
