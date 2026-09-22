#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { cost_run_report, type RunCostReport } from '#scripts/cost/cost-run-report'
import { cost_run_tree } from '#scripts/cost/cost-run-tree'
import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { observation_ledger_line } from '#scripts/observations/observation-ledger-line'
import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { run_carry } from '#scripts/run/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { retrospective, type RetrospectiveInputs } from './retrospective'

// `josh retrospective` — the end-of-run retrospective (joshuafolkken/kit#2328). It is the aggregation
// half: it gathers the four measurements that already exist and prints the digest `retrospective.ts`
// composes, so the retrospective step has one place to read the run it just finished. **When to run it
// is the run driver's** — `run:step` prints it at the stop position, once per invocation — and **what to
// file from it is `retrospective.md`'s**; this only reads and shapes.
//
// **Kit-only.** It reads kit's own development run — its transcript store, its review ledger, its event
// stream — so it means nothing in a consumer project and is dropped from a consumer's help and refused
// there, through the existing `is_kit_only` declaration rather than a new judgement.

const SUCCESS_EXIT_CODE = 0
// `read_from` returns every event past the given position, so zero is "the whole stream from the start".
const STREAM_START = 0

function read_cost(cwd: string): RunCostReport | undefined {
	const tree = cost_run_tree.load(cwd, undefined)

	if (tree === undefined) return undefined

	return cost_run_report.build(tree.run_count, tree.unattributed_count, tree.nodes)
}

async function read_ledger(): Promise<string> {
	try {
		return await readFile(OBSERVATION_LEDGER_PATH, 'utf8')
	} catch {
		return ''
	}
}

function ledger_entries(content: string): Array<string> {
	return content.split('\n').filter((line) => observation_ledger_line.is_ledger_entry_line(line))
}

async function read_events(): Promise<ReadonlyArray<RunEvent>> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return []

	return run_event_stream.read_from(run_event_stream.target_of(directory), STREAM_START).events
}

async function gather(cwd: string): Promise<RetrospectiveInputs> {
	const ledger = await read_ledger()

	return {
		cost: read_cost(cwd),
		findings: review_finding_ledger.category_counts(ledger),
		zero_rounds: review_finding_ledger.zero_round_count(ledger),
		observations: ledger_entries(ledger),
		events: await read_events(),
	}
}

async function run(cwd: string = process.cwd()): Promise<number> {
	console.info(retrospective.compose(await gather(cwd)))

	return SUCCESS_EXIT_CODE
}

async function main(): Promise<void> {
	process.exitCode = await run()
}

const retrospective_cli = { gather, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { retrospective_cli }
