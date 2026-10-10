import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { RunNode, RunRole } from '#scripts/cost/cost-run-nodes'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import type { SessionTranscript } from './guard-friction'

// A run session built from fixture transcript lines, shared by the guard-friction and
// investigation-payback suites.

const { BRANCH, at, ms } = time_transcript_fixture
const MODEL = 'claude-haiku-4-5'

// One priced request at the given minute, carrying `context` tokens read from the cache.
function record(minute: number, context: number): UsageRecord {
	return {
		request_id: `r${String(minute)}`,
		model: MODEL,
		branch: BRANCH,
		at_ms: ms(minute),
		totals: { ...cost_usage.EMPTY_TOTALS, cache_read_tokens: context },
	}
}

interface NodeShape {
	role?: RunRole
	parent_id?: string
	records?: ReadonlyArray<UsageRecord>
}

function node(session_id: string, shape: NodeShape = {}): RunNode {
	return {
		session_id,
		role: shape.role ?? 'lane',
		issue: undefined,
		parent_id: shape.parent_id,
		depth: shape.role === 'subagent' ? 1 : 0,
		modified_ms: 0,
		records: shape.records ?? [],
		baseline_tokens: 0,
		is_readable: true,
		took_cut: false,
	}
}

function session(run_node: RunNode, lines: ReadonlyArray<string>): SessionTranscript {
	return { node: run_node, lines: time_transcript_line.parse_text(lines.join('\n')) }
}

// The feedback line the harness writes when a Stop hook sends the turn back.
function stop_line(minute: number, reason: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		message: { role: 'user', content: `Stop hook feedback:\n${reason}` },
	})
}

// A PreToolUse deny, in the shape the harness writes it: its label, then the guard's reason.
function refusal_line(minute: number, id: string, reason: string): string {
	return time_transcript_fixture.error_result_line(
		minute,
		BRANCH,
		id,
		`PreToolUse:Bash hook error: ${reason}`,
	)
}

function investigator_call_line(minute: number, id: string): string {
	return time_transcript_fixture.tool_call_line(minute, BRANCH, {
		name: 'Agent',
		input: { subagent_type: 'investigator', prompt: 'read' },
		id,
	})
}

const guard_friction_fixture = {
	record,
	node,
	session,
	stop_line,
	refusal_line,
	investigator_call_line,
}

export { guard_friction_fixture }
