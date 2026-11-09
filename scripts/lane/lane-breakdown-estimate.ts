import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_closing_pr } from '#scripts/issue/issue-closing-pr'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import {
	historical_evidence,
	type EvidenceRead,
	type HistoricalEvidence,
} from './historical-evidence'
import { lane_breakdown_pause } from './lane-breakdown-pause'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import { lane_stop_stats } from './lane-stop-stats'

interface Timeline {
	entries: ReadonlyArray<LedgerEntry>
	events: ReadonlyArray<RunEvent>
	notice: string
}

const SHIP_STAGE = 'ship-stage'

function boundary(
	entries: ReadonlyArray<LedgerEntry>,
	evidence: ReadonlyArray<HistoricalEvidence>,
	issue: number,
	kind: 'dispatch' | 'merge',
): LedgerEntry | undefined {
	const measured = entries.filter(
		(entry) => 'issue' in entry && entry.issue === issue && entry.kind === kind,
	)
	const existing = kind === 'dispatch' ? measured[0] : measured.at(-1)
	if (existing !== undefined) return existing
	const candidates = evidence.filter((point) =>
		kind === 'dispatch' ? point.kind !== 'merge' : point.kind === 'merge',
	)
	const point = kind === 'dispatch' ? candidates[0] : candidates.at(-1)

	return point === undefined ? undefined : { kind, issue, at: point.at }
}

function marker(point: HistoricalEvidence, issue: number): RunEvent | undefined {
	const text = issue_cite.plain_for('program', issue)
	if (point.kind === 'plan') return { pos: 0, at: point.at, kind: 'plan', text: `${text} plan` }

	if (point.kind === 'ship-review') {
		return { pos: 0, at: point.at, kind: SHIP_STAGE, text: `${text} review start` }
	}

	if (point.kind === 'pinned') {
		return { pos: 0, at: point.at, kind: SHIP_STAGE, text: `${text} pre-detach start` }
	}

	return undefined
}

function same_stage(measured: RunEvent, inferred: RunEvent): boolean {
	if (lane_stop_stats.issue_of(measured) !== lane_stop_stats.issue_of(inferred)) return false
	if (inferred.kind === 'plan') return lane_breakdown_pause.is_planning(measured)
	if (measured.kind !== SHIP_STAGE) return false
	const actual = run_ship_stage.words_of(measured.text)
	const estimated = run_ship_stage.words_of(inferred.text)

	return actual.stage === estimated.stage && actual.phase === estimated.phase
}

function with_markers(
	events: ReadonlyArray<RunEvent>,
	evidence: ReadonlyArray<HistoricalEvidence>,
	issue: number,
): ReadonlyArray<RunEvent> {
	const inferred = evidence.flatMap((point) => {
		const event = marker(point, issue)
		if (event === undefined) return []
		const has_measured = events.some((entry) => same_stage(entry, event))

		return has_measured ? [] : [event]
	})

	const unique = [...new Map(inferred.toReversed().map((event) => [event.text, event])).values()]

	return [...events, ...unique].toSorted(
		(left, right) => Date.parse(left.at) - Date.parse(right.at),
	)
}

function reconstruct(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	{ evidence, unreadable }: EvidenceRead,
): Timeline | undefined {
	const bounds = [
		boundary(entries, evidence, issue, 'dispatch'),
		boundary(entries, evidence, issue, 'merge'),
	]
	const supplemented = [...entries, ...bounds.filter((entry) => entry !== undefined)]

	if (lane_net_time.span_of(supplemented, issue) === undefined) {
		console.error(
			`Insufficient historical evidence: dispatch/start or merge/end missing or reversed; unreadable: ${unreadable.join(', ') || 'none'}`,
		)

		return undefined
	}

	const sources = [...new Set(evidence.map((point) => `${point.kind}: ${point.source}`))]

	return {
		entries: supplemented,
		events: with_markers(events, evidence, issue),
		notice: `Estimated timeline (missing ledger boundaries reconstructed; measured records take precedence).\nSources: ${sources.join('; ')}\nUnreadable sources: ${unreadable.join(', ') || 'none'}`,
	}
}

async function read(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Promise<Timeline | undefined> {
	if (lane_net_time.span_of(entries, issue) !== undefined) return { entries, events, notice: '' }
	if (lane_net_time.missing_reason(entries, issue) === 'cause unknown') return undefined
	const closing = await issue_closing_pr.read_closing_number_result(issue)
	const pr_number = closing.kind === 'read' ? closing.number : undefined
	const evidence = await historical_evidence.read({ issue, pr_number })
	const unreadable =
		closing.kind === 'unreadable'
			? [...evidence.unreadable, 'closing pull request discovery']
			: evidence.unreadable

	return reconstruct(entries, events, issue, { ...evidence, unreadable })
}

const lane_breakdown_estimate = { read }

export { lane_breakdown_estimate }
