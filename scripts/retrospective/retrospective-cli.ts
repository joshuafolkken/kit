#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { cost_run_report, type RunCostReport } from '#scripts/cost/cost-run-report'
import { cost_run_tree, type RunTree } from '#scripts/cost/cost-run-tree'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { observation_ledger_line } from '#scripts/observations/observation-ledger-line'
import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_scope, type EventScope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import type { SessionTranscript } from './guard-friction'
import { retrospective, type RetrospectiveInputs } from './retrospective'

// `josh retrospective` — the end-of-run retrospective. It is the aggregation
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

interface TreeRead {
	cost: RunCostReport | undefined
	sessions: ReadonlyArray<SessionTranscript>
}

// Each node paired with its own transcript's lines, read once here so the composer stays pure.
function sessions_of(tree: RunTree): Array<SessionTranscript> {
	const paths = new Map(tree.files.map((file) => [file.session_id, file]))

	return tree.nodes.map((node) => {
		const file = paths.get(node.session_id)
		const text = file === undefined ? '' : cost_transcript.read_raw(file)

		return { node, lines: time_transcript_line.parse_text(text) }
	})
}

function read_tree(cwd: string): TreeRead {
	const tree = cost_run_tree.load(cwd, undefined)

	if (tree === undefined) return { cost: undefined, sessions: [] }

	return {
		cost: cost_run_report.build(tree.run_count, tree.unattributed_count, tree.nodes),
		sessions: sessions_of(tree),
	}
}

// Every issue's file of the ledger directory, read as one.
async function read_ledger(cwd: string): Promise<string> {
	return (await observation_ledger_home.read(cwd)) ?? ''
}

function ledger_entries(content: string): Array<string> {
	return content.split('\n').filter((line) => observation_ledger_line.is_ledger_entry_line(line))
}

interface RunRead {
	events: ReadonlyArray<RunEvent>
	scope: EventScope
}

// The stream and the scope that bounds it, read from the one directory the carry record and the event stream
// share. The whole stream is read — `scoped_events` filters it to this invocation —
// and an unresolvable directory has no record to scope with, which is the undetermined answer an absent
// record gives.
async function read_run(): Promise<RunRead> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return { events: [], scope: run_event_scope.UNKNOWN_EVENT_SCOPE }

	const target = run_event_stream.target_of(directory)
	const { events } = run_event_stream.read_from(target, STREAM_START)
	const scope = run_event_scope.scope_of(run_carry.read_carry(run_carry.carry_path(directory)))

	return { events, scope }
}

async function gather(cwd: string): Promise<RetrospectiveInputs> {
	const ledger = await read_ledger(cwd)
	const run_read = await read_run()
	const tree = read_tree(cwd)

	return {
		cost: tree.cost,
		sessions: tree.sessions,
		findings: review_finding_ledger.category_counts(ledger),
		zero_rounds: review_finding_ledger.zero_round_count(ledger),
		observations: ledger_entries(ledger),
		events: run_read.events,
		scope: run_read.scope,
	}
}

async function run(cwd: string = process.cwd()): Promise<number> {
	console.info(retrospective.compose(await gather(cwd)))

	return SUCCESS_EXIT_CODE
}

async function main(): Promise<void> {
	process.exitCode = await run()
}

const retrospective_cli = { gather }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { retrospective_cli }
