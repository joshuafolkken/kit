import { agent_event } from '#scripts/agent/agent-event'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { transcript_record, type TranscriptBlock } from '#scripts/lib/transcript-record'
import { bash_triggers } from '#scripts/rules/bash-triggers'
import { lane_park } from '#scripts/rules/lane-park'
import { shell_segments } from '#scripts/rules/shell-segments'
import { stop_decision } from '#scripts/rules/stop-decision'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled, type StallCause } from '#scripts/run/park/run-stalled'
import { run_ending } from '#scripts/run/run-ending'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { time_josh_names } from '#scripts/time-runtime/time-josh-names'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { z } from 'zod'
import { run_merge, type ParkReason } from './run-merge'

const HOOK_CONFIRMATION = '📱 stop:guard sent the confirmation notify ('
const INPUT_SCHEMA = z.object({ command: z.string() })
const AWAITING_CONFIRMATION =
	/(?:確認|回答|返答|承認)(?:[をの]?待っています|待ちです|後に(?:続行|再開)します)/u
const COMMAND_SCHEMA = z.looseObject({
	type: z.literal('item.completed'),
	item: z.looseObject({
		type: z.literal('command_execution'),
		command: z.string(),
		exit_code: z.literal(0),
		aggregated_output: z.string().optional(),
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

function successful_last(command: string): string | undefined {
	const joined = shell_segments.joined_continuations(command)
	const plain = time_shell.blanked(joined)
	if (plain === undefined || plain.includes('\n')) return undefined
	const comment = plain.search(/(?:^|[\s;|&])#/u)
	const end = comment === -1 ? joined.length : comment
	const syntax = plain.slice(0, end)

	if (/[;|&\n]/u.test(syntax.replaceAll('&&', ''))) return undefined

	return shell_segments.quote_aware_commands_of(joined.slice(0, end)).at(-1)
}

function is_entry(command: string): boolean {
	for (let next = command; next !== '';) {
		const last = successful_last(next) ?? ''
		const script = bash_triggers.shell_script_of(last)

		if (script === undefined) {
			return time_josh_names.josh_command_of_segment(time_shell.unquoted(last)) === 'josh run:entry'
		}

		next = script
	}

	return false
}

function entry_ids(latest: string): ReadonlySet<string> {
	const records = latest.split('\n').flatMap((line) => transcript_record.parse(line) ?? [])
	const calls = records
		.filter((record) => record.type === 'assistant')
		.flatMap((record) => transcript_record.tool_calls_of(record))
	const entries = calls.filter(
		(block) =>
			block.name === 'Bash' && is_entry(INPUT_SCHEMA.safeParse(block.input).data?.command ?? ''),
	)

	return new Set(entries.flatMap((block) => block.id ?? []))
}

function is_entry_result(block: TranscriptBlock | undefined, ids: ReadonlySet<string>): boolean {
	return (
		block?.type === transcript_record.TOOL_RESULT_TYPE &&
		block.is_error !== true &&
		ids.has(block.tool_use_id ?? '')
	)
}

function claude_output(line: string, ids: ReadonlySet<string>): string {
	const record = transcript_record.parse(line)
	if (record?.type !== 'user') return ''
	const blocks = transcript_record.blocks_of(record)

	return cost_blocks
		.parse_line(line)
		.filter((_block, index) => is_entry_result(blocks[index], ids))
		.map((block) => block.text)
		.join('\n')
}

function tool_output(line: string, ids: ReadonlySet<string>): string {
	const command = COMMAND_SCHEMA.safeParse(json_value.parse_or_undefined(line))
	if (!command.success) return claude_output(line, ids)

	return is_entry(command.data.item.command) ? (command.data.item.aggregated_output ?? '') : ''
}

function unfinished(latest: string, message: string): StallCause {
	const ids = entry_ids(latest)
	const outputs = latest
		.split('\n')
		.map((line) => tool_output(line, ids))
		.join('\n')
	const resumes = [...outputs.matchAll(/^entry [^\n]+ — resume: ([\w-]+)$/gmu)]

	return resumes.at(-1)?.[1] === 'handed-off'
		? run_stalled.STALE_HANDOFF
		: run_stalled.session_unfinished(message)
}

// The same fallback judges both the park and its event. Restrict it to the latest launch so an
// earlier session's unanswered question cannot turn a later mechanical failure into a decision.
function judged(transcript: string): StallCause {
	const latest = run_ship_detach.last_launch(transcript)
	const message = agent_event.read(latest).last_message ?? ''
	const is_confirmed = latest.split('\n').some((line) => confirms(line))

	if (!is_confirmed && !asks(message)) return unfinished(latest, message)

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
		? `${issue_cite.plain_for('program', child)} parked (${NEEDS_DECISION_LABEL})`
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
