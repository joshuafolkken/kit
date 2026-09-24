import { setTimeout as sleep } from 'node:timers/promises'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type CarryOwner, type RunCarry } from '#scripts/run/run-carry'
import { run_merge_cli } from '#scripts/run/run-merge-cli'
import { backlog_budget, type BudgetInput } from './backlog-budget'
import type { ChildResult, DriveOffer, DrivePorts, OfferAsk } from './backlog-drive'
import { backlog_offer } from './backlog-offer'
import { backlog_offer_cli } from './backlog-offer-cli'

// The production wiring of `backlog:drive`'s ports (joshuafolkken/kit#2508). Each port is the call the
// parent session used to make as a turn, now made in-process: the offer reads `backlog:next` and asks
// `backlog_offer.answer_of` and `backlog_budget.decide`, the launch is `lane:launch`'s chain, the merge is
// `run:merge`'s, and the end is the report followed by the record's end, in that order.

const should_forward_stderr = true
const EXHAUSTED_ANSWER = 'exhausted'
const NO_RUNNING = 0

interface DriveOptions {
	max_issues: number | undefined
	idle_budget_ms: number | undefined
	owner: CarryOwner
}

// The carry record, re-read at every ask so the merged count and the start are the record's — counted
// across cuts — and never the driver's own.
async function read_record(): Promise<RunCarry | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	const read = run_carry.read_carry(run_carry.carry_path(directory))

	return read.kind === 'carried' || read.kind === 'expired' ? read.carry : undefined
}

function budget_input(
	ask: OfferAsk,
	carry: RunCarry,
	options: DriveOptions,
): Omit<BudgetInput, 'answer'> {
	return {
		merged: carry.merged,
		running: ask.running,
		started_at_ms: Date.parse(carry.started_at),
		active_at_ms: ask.active_at_ms,
		now_ms: Date.now(),
		max_issues: options.max_issues,
		idle_budget_ms: options.idle_budget_ms,
	}
}

async function offer(ask: OfferAsk, carry: RunCarry, options: DriveOptions): Promise<DriveOffer> {
	const next = await josh_command.josh_run(
		backlog_offer_cli.next_argv({ exclude: ask.excludes }),
		should_forward_stderr,
	)
	const answer = backlog_offer.answer_of(
		{ code: next.code, tokens: backlog_offer_cli.to_tokens(next.out) },
		ask.running,
		ask.retries,
	)
	const input = {
		...budget_input(ask, (await read_record()) ?? carry, options),
		answer: answer.answer,
	}
	const decision = backlog_budget.decide(input)

	console.error(decision.reason)

	return { ...decision, ...answer, is_finish: backlog_budget.is_finish(input) }
}

async function merge(issue: string, owner: CarryOwner): Promise<ChildResult> {
	const lane = await lane_registry.find_open_lane(issue)

	return await run_merge_cli.merge_child({
		child: issue,
		epic: undefined,
		repo: undefined,
		over: CONTEXT_CUT_THRESHOLD,
		owner,
		output: lane?.output,
	})
}

// The report first, then the record's end: `run:report` scopes by the record `--end` removes. A stop
// that is not the run finishing ends with `--stopped`, which sends the ⏸️ notice a person needs.
async function finish(ended: DriveOffer): Promise<void> {
	const report = await josh_command.josh_run(['run:report'])

	console.error(report.out)
	await josh_command.josh_run(
		ended.is_finish ? ['run:carry', '--end'] : ['run:carry', '--end', '--stopped', ended.reason],
		should_forward_stderr,
	)
	await josh_command.josh_run(['run:wake', '--stop'], should_forward_stderr)
}

async function launch(issue: string, stash: string | undefined): Promise<boolean> {
	return (await lane_launch_cli.launch_lane({ issue, stash })) !== undefined
}

async function mark_drain(): Promise<boolean> {
	return await backlog_offer_cli.mark_drain(
		backlog_budget.WATCH_VERDICT,
		EXHAUSTED_ANSWER,
		NO_RUNNING,
	)
}

function ports_for(carry: RunCarry, options: DriveOptions): DrivePorts {
	return {
		offer: async (ask) => await offer(ask, carry, options),
		launch,
		is_running: lane_await.is_process_running,
		await_any: async (issues) => await lane_await.wait_for_any(issues),
		merge: async (issue) => await merge(issue, options.owner),
		mark_drain,
		finish,
		sleep: async (milliseconds) => {
			await sleep(milliseconds)
		},
		now: () => Date.now(),
	}
}

const backlog_drive_ports = { ports_for, read_record }

export type { DriveOptions }
export { backlog_drive_ports }
