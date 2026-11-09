import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import {
	has_label_name,
	NEEDS_DECISION_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { backlog_auto_triage } from './backlog-auto-triage'
import type { PoolContext } from './backlog-gate-scope'
import { backlog_next } from './backlog-next'
import { backlog_triage_park } from './backlog-triage-park'

const USAGE = 'Usage: josh backlog:triage --pass [--exclude <N>[,<N>...]]'

interface TriageSnapshot {
	result: EpicNextResult
	repo: string
}

function parked_of(plan: TriageSnapshot): ReadonlyArray<EpicChild> {
	return plan.result.blocked_on_people.filter(
		(child) =>
			child.repo === plan.repo &&
			(has_label_name(child.labels, NEEDS_DECISION_LABEL) ||
				has_label_name(child.labels, RUN_STALLED_LABEL)),
	)
}

// Each park's recommendation, tier and `--adopt` line (joshuafolkken/kit#6777), so the parent takes a
// recommendation without re-reading its body. Guidance on stderr: stdout stays the one next command.
// Only a `needs-decision` child: a `run:stalled` one's latest park may be one already adopted, and a
// stall recovers through `run:add --retry`.
async function print_parks(parked: ReadonlyArray<EpicChild>): Promise<void> {
	const lines = await Promise.all(
		parked.map(async (child) => await backlog_triage_park.lines_of(child.number)),
	)

	for (const line of lines.flat()) console.error(line)
}

async function next_action(plan: TriageSnapshot): Promise<string> {
	const { untriaged } = await backlog_auto_triage.untriaged_of(plan.result, plan.repo)
	const parked = parked_of(plan)
	const pending = [...parked, ...untriaged]
	const numbers = [...new Set(pending.map((child) => child.number))]

	if (numbers.length === 0) return 'pnpm josh backlog:plan --waves'

	console.error(
		'Answer existing decisions from the body and comments; keep questions needing a person or measurement parked. Use backlog:triage --decide for the three solo conditions, then --apply with the reason and any --blocked-by / --clear. Repeat --pass, excluding decisions left parked in this pass.',
	)
	console.error(
		'For a park whose recommendation you take, use backlog:triage --apply <N> --adopt <k> --reason <text>: it records the decision, clears the park and requeues in one call. For other Tier A answers, use epic --decide to record the decision and clear needs-decision; for recovered failures, use run:add --retry. Record dependencies with backlog:triage --apply --blocked-by; leave questions needing a person or measurement parked and exclude them from this pass.',
	)
	await print_parks(parked.filter((child) => has_label_name(child.labels, NEEDS_DECISION_LABEL)))

	return `pnpm josh issue:read ${numbers.join(' ')}`
}

async function report(plan: TriageSnapshot | undefined): Promise<number> {
	if (plan === undefined || plan.result.verdict === 'error') {
		console.error('Could not classify the backlog; retry backlog:triage --pass before proceeding.')

		return 1
	}

	console.info(await next_action(plan))

	return 0
}

async function classify(context: PoolContext | undefined): Promise<number> {
	if (context === undefined) return await report(undefined)

	if (context.opted_in.cutoff !== 'none' || context.tracking.cutoff !== 'none') {
		console.error('The backlog listing is incomplete; a full triage pass cannot be confirmed.')

		return 1
	}

	const result = await backlog_next.resolve(context)

	return await report(result === undefined ? undefined : { result, repo: context.repo })
}

async function read_pass(exclude: ReadonlyArray<number>): Promise<number> {
	const opted_in = await auto_ok_cli.fetch_opted_in()

	if (opted_in.kind !== 'read') {
		console.error('Could not read the opted-in backlog; retry backlog:triage --pass.')

		return 1
	}

	return await classify(await backlog_next.context_of(opted_in, exclude))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = auto_ok_cli.parse_options(argv, USAGE)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return 1
	}

	return await read_pass(options.exclude ?? [])
}

const backlog_triage_pass = { run }

export { backlog_triage_pass }
