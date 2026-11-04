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

beforeEach(() => {
	vi.spyOn(run_ending, 'read_transcript').mockReturnValue(undefined)
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

describe('run_merge_decision — prior launch confirmation', () => {
	it('keeps the latest ordinary message after a prior launch confirmation', () => {
		vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
			`📱 stop:guard sent the confirmation notify (#6268).${HEADER}${transcript(NORMAL)}`,
		)

		expect(run_merge_decision.cause(OUTPUT)).toStrictEqual({ short: NORMAL, why: NORMAL })
	})
})
