import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_ending } from '#scripts/run/run-ending'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_cap } from './run-merge-cap'
import { run_merge_decision } from './run-merge-decision'
import { run_merge_decision_fixture } from './run-merge-decision-fixture'

const OUTPUT = '/stub/6268.log'
const { MESSAGES, transcript } = run_merge_decision_fixture
const NEEDS_DECISION = 'needs-decision'
const NORMAL = 'Implementation ended before completion.'
const HEADER = '\n=== 2026-11-04T00:00:00Z · started by process 42 · codex ===\n'
const NOTIFY = 'pnpm josh notify --task-type confirmation --body-file .josh/tmp/question.md'
const ITEM_COMPLETED = 'item.completed'
const ENTRY_COMMAND = 'pnpm josh run:entry 6339'
const READ_LOG_COMMAND = 'cat previous-run.log'
const HANDED_OFF =
	'entry [#6339](https://github.com/joshuafolkken/kit/issues/6339) — resume: handed-off'
const CLAUDE_CALL = JSON.stringify({
	type: 'assistant',
	message: {
		content: [{ type: 'tool_use', id: 'entry', name: 'Bash', input: { command: ENTRY_COMMAND } }],
	},
})
const CLAUDE_RESULT = JSON.stringify({
	type: 'user',
	message: { content: [{ type: 'tool_result', tool_use_id: 'entry', content: HANDED_OFF }] },
})
const HANDOFF_OUTPUTS = [
	JSON.stringify({
		type: ITEM_COMPLETED,
		item: {
			type: 'command_execution',
			command: ENTRY_COMMAND,
			aggregated_output: HANDED_OFF,
			exit_code: 0,
		},
	}),
	`${CLAUDE_CALL}\n${CLAUDE_RESULT}`,
]
const QUOTED_ENTRY_COMMANDS = [
	`printf '%s\\n' 'quoted; ${ENTRY_COMMAND}; quoted\n${HANDED_OFF}'`,
	`cat <<'EOF'\n${ENTRY_COMMAND}\n${HANDED_OFF}\nEOF`,
]
const EXECUTED_ENTRY_COMMANDS = [
	ENTRY_COMMAND,
	`/bin/zsh -lc '${ENTRY_COMMAND}'`,
	`bash -c "${ENTRY_COMMAND}"`,
	`cd /tmp && ${ENTRY_COMMAND}`,
	`cd /tmp && /bin/zsh -lc '${ENTRY_COMMAND}'`,
	`${ENTRY_COMMAND} # completed && ignored`,
	`printf '%s' '#' && ${ENTRY_COMMAND}`,
]
const SKIPPED_ENTRY_COMMANDS = [
	`${READ_LOG_COMMAND} # && ${ENTRY_COMMAND}`,
	`${ENTRY_COMMAND} # completed\n${READ_LOG_COMMAND}`,
	`/bin/sh -c '${READ_LOG_COMMAND}' '&& ${ENTRY_COMMAND}'`,
	`/bin/sh -c '${READ_LOG_COMMAND} # && ${ENTRY_COMMAND}'`,
	`/bin/sh -c '${READ_LOG_COMMAND} "&& ${ENTRY_COMMAND}"'`,
	`false && ${ENTRY_COMMAND}; ${READ_LOG_COMMAND}`,
	`false && ${ENTRY_COMMAND} || ${READ_LOG_COMMAND}`,
	`${ENTRY_COMMAND}; ${READ_LOG_COMMAND}`,
	`${ENTRY_COMMAND} | ${READ_LOG_COMMAND}`,
	`/bin/zsh -lc 'false && ${ENTRY_COMMAND}; ${READ_LOG_COMMAND}'`,
]
const EXECUTED_HANDOFFS = EXECUTED_ENTRY_COMMANDS.flatMap((command) =>
	HANDOFF_OUTPUTS.map((output) =>
		output.replace(JSON.stringify(ENTRY_COMMAND), () => JSON.stringify(command)),
	),
)
const HANDOFF_NEGATIVES = [
	...[...QUOTED_ENTRY_COMMANDS, ...SKIPPED_ENTRY_COMMANDS].flatMap((command) =>
		HANDOFF_OUTPUTS.map((output) =>
			output.replace(JSON.stringify(ENTRY_COMMAND), () => JSON.stringify(command)),
		),
	),
	CLAUDE_RESULT,
	`${CLAUDE_CALL}\n${CLAUDE_RESULT.replace('"type":"tool_result"', '"type":"tool_result","is_error":true')}`,
	`${CLAUDE_CALL.replace(ENTRY_COMMAND, () => READ_LOG_COMMAND)}\n${CLAUDE_RESULT}`,
	JSON.stringify({
		type: ITEM_COMPLETED,
		item: {
			type: 'command_execution',
			command: READ_LOG_COMMAND,
			aggregated_output: HANDED_OFF,
			exit_code: 0,
		},
	}),
	JSON.stringify({
		type: ITEM_COMPLETED,
		item: {
			type: 'command_execution',
			command: ENTRY_COMMAND,
			aggregated_output: HANDED_OFF,
			exit_code: 1,
		},
	}),
	`${HANDOFF_OUTPUTS[0] ?? ''}\n${(HANDOFF_OUTPUTS[0] ?? '').replace('handed-off', 'fresh')}`,
]
const INLINE_QUESTION =
	'#6323 を仕様どおりとして終了しますか？ それとも、保持席をボードに表示する変更へ見直しますか？ 推奨は終了です。'
const STOP_GUARD = JSON.stringify({
	type: ITEM_COMPLETED,
	item: {
		type: 'command_execution',
		command: 'printf payload | pnpm josh stop:guard',
		aggregated_output: '$ node --import tsx scripts/josh/josh.ts stop:guard',
		exit_code: 0,
	},
})

beforeEach(() => {
	vi.spyOn(run_ending, 'read_transcript').mockReturnValue(undefined)
})

describe('run_merge_decision — inline questions', () => {
	it.each(['', `${STOP_GUARD}\n`])(
		'reads the inline questions from #6323 (ac-96fc8aea): %s',
		(command) => {
			vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
				`${command}${transcript(INLINE_QUESTION)}`,
			)

			expect(run_merge_decision.cause(OUTPUT)).toStrictEqual({
				short: NEEDS_DECISION,
				why: INLINE_QUESTION,
			})
		},
	)

	it('keeps a stop guard without confirmation mechanical (ac-21828827)', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(`${STOP_GUARD}\n${transcript(NORMAL)}`)

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual(run_stalled.session_unfinished(NORMAL))
	})
})

describe('run_merge_decision — the latest final reply', () => {
	it.each(MESSAGES)('shares the question fallback with the cap (ac-6f40a59d): %s', (message) => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(transcript(message))

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual({ short: NEEDS_DECISION, why: message })
		expect(run_merge_cap.park_cause('6268', undefined, undefined, OUTPUT).short).toBe(
			NEEDS_DECISION,
		)
	})

	it.each([undefined, ''])(
		'keeps an ordinary unfinished session mechanical (ac-f9e5a4ce): %s',
		(text) => {
			vi.spyOn(run_ending, 'read_transcript').mockReturnValue(text)

			expect(run_merge_decision.cause(OUTPUT)).toBe(run_stalled.SESSION_UNFINISHED)
		},
	)

	it('ignores tool text and earlier questions once the agent has answered', () => {
		const command = JSON.stringify({
			type: ITEM_COMPLETED,
			item: { type: 'command_execution', text: 'Proceed?' },
		})

		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			`${transcript('Proceed?')}\n${transcript(NORMAL)}\n${command}`,
		)

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual(run_stalled.session_unfinished(NORMAL))
	})
})

describe('run_merge_decision — mechanical final replies', () => {
	it.each([NORMAL, `${NORMAL} See https://ci.example/build?job=42 for the failure log.`])(
		'keeps a mechanical message after an earlier launch question: %s',
		(message) => {
			vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
				`${transcript(MESSAGES[0] ?? '')}${HEADER}${transcript(message)}`,
			)

			expect(run_merge_decision.cause(OUTPUT)).toStrictEqual(
				run_stalled.session_unfinished(message),
			)
		},
	)
})

describe('run_merge_decision — confirmation evidence', () => {
	it.each([
		'📱 stop:guard sent the confirmation notify (#6268).',
		JSON.stringify({
			type: ITEM_COMPLETED,
			item: { type: 'command_execution', command: NOTIFY, exit_code: 0 },
		}),
	])('reads a sent confirmation: %s', (confirmation) => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			`${transcript(NORMAL)}\n${confirmation}`,
		)

		expect(run_merge_decision.cause(OUTPUT).short).toBe(NEEDS_DECISION)
	})

	it.each([
		JSON.stringify({
			type: ITEM_COMPLETED,
			item: {
				type: 'command_execution',
				command: 'cat CLAUDE.md',
				aggregated_output: NOTIFY,
				exit_code: 0,
			},
		}),
		JSON.stringify({
			type: ITEM_COMPLETED,
			item: { type: 'command_execution', command: NOTIFY, exit_code: 1 },
		}),
	])('ignores documentation, failed sends and prior launches: %s', (text) => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(text)

		expect(run_merge_decision.cause(OUTPUT)).toBe(run_stalled.SESSION_UNFINISHED)
	})
})

describe('run_merge_decision — stale hand-off', () => {
	it.each(HANDOFF_NEGATIVES)(
		'ignores quoted, failed and superseded hand-offs (ac-dc87fe75): %s',
		(text) => {
			vi.spyOn(run_ending, 'read_transcript').mockReturnValue(text)

			expect(run_merge_decision.cause(OUTPUT)).toBe(run_stalled.SESSION_UNFINISHED)
		},
	)
	it.each(EXECUTED_HANDOFFS)('names the stale cut record (ac-94c3f036): %s', (text) => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(text)

		expect(run_merge_decision.cause(OUTPUT).short).toBe('stale hand-off')
	})

	it('explains the stale cut cause (ac-5358d4e9)', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(HANDOFF_OUTPUTS[0])
		const judgment = run_merge_decision.cause(OUTPUT)
		const options = run_merge_decision.park_options(judgment, {
			child: '6339',
			cause: judgment.why,
			carry: undefined,
			output: OUTPUT,
		})

		expect(options.comment).toContain(
			'- Why: the child stopped at `resume: handed-off` because an old hand-off cut record was already adopted.',
		)
	})

	it('ignores hand-offs from earlier launches (ac-dc87fe75)', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			`${HANDOFF_OUTPUTS[0] ?? ''}${HEADER}${transcript(NORMAL)}`,
		)

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual(run_stalled.session_unfinished(NORMAL))
	})
})

describe('run_merge_decision — prior launch confirmation', () => {
	it('keeps quoted hand-off text as the final message', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(transcript(HANDED_OFF))

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual(
			run_stalled.session_unfinished(HANDED_OFF),
		)
	})

	it('keeps the latest ordinary message after a prior launch confirmation', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			`📱 stop:guard sent the confirmation notify (#6268).${HEADER}${transcript(NORMAL)}`,
		)

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual({
			short: `session unfinished: ${NORMAL}`,
			why: NORMAL,
		})
	})
})
