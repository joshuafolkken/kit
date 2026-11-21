import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hook_decision } from './hook-decision'

const make_directory = temporary_directory('suite')
const TRANSCRIPT = path.join(make_directory('guard-options-'), 'session.jsonl')
const SWITCH_KEY = 'JOSH_GUARD_OPTIONS_TEST'
const NOW_MS = 1_700_000_000_000
const EXPLICIT_MS = NOW_MS + 1
const CONTEXT = hook_context_fixture.of(path.dirname(TRANSCRIPT), {})
const REASON = 'options test refusal'
const PREFIX = 'josh-guard-options-test-'
const should_block = vi.fn(() => true)
const guard = hook_decision.create_transcript_guard({
	prefix: PREFIX,
	switch_key: SWITCH_KEY,
	is_candidate: () => true,
	should_block,
	reason: REASON,
})
const PAYLOAD = JSON.stringify({
	transcript_path: TRANSCRIPT,
	tool_name: 'Read',
	tool_input: { file_path: 'subject.ts' },
})

beforeEach(() => {
	writeFileSync(TRANSCRIPT, '')
	vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
	vi.stubEnv(SWITCH_KEY, '')
})

afterEach(() => {
	rmSync(guard.refusal_path(TRANSCRIPT), { force: true })
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('transcript guard options', () => {
	it('uses the current clock and process environment with options omitted', () => {
		expect(guard.refusal(PAYLOAD)).toBe(REASON)
		expect(should_block).toHaveBeenCalledWith(
			'',
			expect.any(Object),
			hook_decision.NEVER_MS,
			expect.objectContaining({
				now_ms: NOW_MS,
				context: expect.objectContaining({ env: process.env }),
			}),
		)
		expect(hook_decision.create_refusal_stamp(PREFIX).last_ms(guard.refusal_path(TRANSCRIPT))).toBe(
			NOW_MS,
		)
	})

	it('uses the process switch with empty options', () => {
		vi.stubEnv(SWITCH_KEY, 'off')

		expect(guard.outcome(PAYLOAD, {}).reason).toBeUndefined()
		expect(should_block).not.toHaveBeenCalled()
	})
})

describe('transcript guard explicit options', () => {
	it('uses an explicit context and defaults only the clock', () => {
		vi.stubEnv(SWITCH_KEY, 'off')

		expect(guard.outcome(PAYLOAD, { context: CONTEXT }).reason).toBe(REASON)
		expect(should_block).toHaveBeenCalledWith(
			'',
			expect.any(Object),
			hook_decision.NEVER_MS,
			expect.objectContaining({ now_ms: NOW_MS, context: CONTEXT }),
		)
	})

	it('forwards explicit time and context through refusal and records that instant', () => {
		expect(guard.refusal(PAYLOAD, { now_ms: EXPLICIT_MS, context: CONTEXT })).toBe(REASON)
		expect(should_block).toHaveBeenCalledWith(
			'',
			expect.any(Object),
			hook_decision.NEVER_MS,
			expect.objectContaining({ now_ms: EXPLICIT_MS, context: CONTEXT }),
		)
		expect(hook_decision.create_refusal_stamp(PREFIX).last_ms(guard.refusal_path(TRANSCRIPT))).toBe(
			EXPLICIT_MS,
		)
	})
})
