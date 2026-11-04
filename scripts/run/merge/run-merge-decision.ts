import { agent_event } from '#scripts/agent/agent-event'
import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { lane_park } from '#scripts/rules/lane-park'
import { stop_decision } from '#scripts/rules/stop-decision'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled, type StallCause } from '#scripts/run/park/run-stalled'
import { run_ending } from '#scripts/run/run-ending'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { z } from 'zod'
import { run_merge, type ParkReason } from './run-merge'

const HOOK_CONFIRMATION = '📱 stop:guard sent the confirmation notify ('
const AWAITING_CONFIRMATION =
	/(?:確認|回答|返答|承認)(?:[をの]?待っています|待ちです|後に(?:続行|再開)します)/u
const COMMAND_SCHEMA = z.looseObject({
	type: z.literal('item.completed'),
	item: z.looseObject({
		type: z.literal('command_execution'),
		command: z.string(),
		exit_code: z.literal(0),
	}),
})

function confirms(line: string): boolean {
	if (line.startsWith(HOOK_CONFIRMATION)) return true
	const command = COMMAND_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	return command.success && lane_park.is_confirmation_notify(command.data.item.command)
}

function asks(message: string): boolean {
	return AWAITING_CONFIRMATION.test(message) || stop_decision.contains_question(message)
}

// The same fallback judges both the park and its event. Restrict it to the latest launch so an
// earlier session's unanswered question cannot turn a later mechanical failure into a decision.
function judged(transcript: string): StallCause {
	const latest = run_ship_detach.last_launch(transcript)
	const message = agent_event.read(latest).last_message ?? ''
	const is_confirmed = latest.split('\n').some((line) => confirms(line))

	if (!is_confirmed && !asks(message)) return run_stalled.SESSION_UNFINISHED

	return {
		short: NEEDS_DECISION_LABEL,
		why: message || 'The child sent a confirmation notification.',
	}
}

function cause(output: string | undefined): StallCause {
	const transcript = output === undefined ? undefined : run_ending.read_transcript(output)

	return transcript === undefined ? run_stalled.SESSION_UNFINISHED : judged(transcript)
}

function is_decision(short: string | undefined): boolean {
	return short === NEEDS_DECISION_LABEL
}

function park_event(child: string, short: string): string {
	return is_decision(short)
		? `${issue_cite.plain(child)} parked (${NEEDS_DECISION_LABEL})`
		: run_stalled.park_event(child, short)
}

function park_comment(judgment: StallCause): string {
	return [
		`Parked with \`${NEEDS_DECISION_LABEL}\` by \`pnpm josh run:merge\`: the child waits for your answer.`,
		`- Decision: ${judgment.why}`,
		'- Consecutive failures: unchanged.',
		'- Next: answer the question on this issue, then remove `needs-decision` to resume.',
	].join('\n')
}

function park_options(
	judgment: StallCause,
	reason: ParkReason,
): { label: string; comment: string } {
	return is_decision(judgment.short)
		? { label: NEEDS_DECISION_LABEL, comment: park_comment(judgment) }
		: { label: RUN_STALLED_LABEL, comment: run_merge.park_comment(reason) }
}

function is_guard_tripped(short: string, carry: RunCarry | undefined): boolean {
	if (is_decision(short)) return false

	return carry !== undefined && run_merge.is_guard_tripped(carry.failures)
}

const run_merge_decision = { cause, is_decision, is_guard_tripped, park_event, park_options }

export { run_merge_decision }
