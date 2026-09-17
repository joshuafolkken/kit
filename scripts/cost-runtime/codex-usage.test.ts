import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { codex_usage } from './codex-usage'

const THREAD_ID = '01a0aac9-0a31-7f33-9289-e336403947ef'
const TARGET = '/projects/kit'
const INHERITED_INPUT = 10_000
const FIRST_INPUT = 100
const TOTAL_INPUT = 350
const REQUEST_COUNT = 2
const HOME_PREFIX = 'codex-usage-'
const PREVIOUS_THREAD_ID = 'previous-generation'

function token_count(input_tokens: number, last_input_tokens: number): string {
	return JSON.stringify({
		type: 'event_msg',
		payload: {
			type: 'token_count',
			info: {
				total_token_usage: { input_tokens },
				last_token_usage: { input_tokens: last_input_tokens },
			},
		},
	})
}

function environment(): Record<string, string> {
	return { CODEX_THREAD_ID: THREAD_ID }
}

function write_rollout_for(
	home: string,
	cwd: string,
	thread_id: string,
	metadata_thread_id: string = thread_id,
): void {
	const directory = path.join(home, 'sessions/2026/09/16')

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `rollout-${thread_id}.jsonl`),
		[
			JSON.stringify({ type: 'session_meta', payload: { id: metadata_thread_id, cwd } }),
			token_count(INHERITED_INPUT + FIRST_INPUT, FIRST_INPUT),
			token_count(INHERITED_INPUT + TOTAL_INPUT, TOTAL_INPUT - FIRST_INPUT),
		].join('\n'),
	)
}

function write_rollout(home: string, cwd: string): void {
	write_rollout_for(home, cwd, THREAD_ID)
}

describe('codex_usage.measurement — active rollout', () => {
	it('reads token counts before a terminal turn.completed event exists', () => {
		const home = mkdtempSync(path.join(tmpdir(), HOME_PREFIX))
		const codex_home = path.join(home, '.codex')

		write_rollout(codex_home, TARGET)

		expect(codex_usage.measurement(TARGET, home, environment())).toStrictEqual({
			request_count: REQUEST_COUNT,
			billed_input_tokens: TOTAL_INPUT,
		})
	})

	it('does not mix an earlier generation into the current thread measurement', () => {
		const home = mkdtempSync(path.join(tmpdir(), HOME_PREFIX))
		const codex_home = path.join(home, '.codex')

		write_rollout_for(codex_home, TARGET, PREVIOUS_THREAD_ID)
		write_rollout(codex_home, TARGET)

		expect(codex_usage.measurement(TARGET, home, environment())).toStrictEqual({
			request_count: REQUEST_COUNT,
			billed_input_tokens: TOTAL_INPUT,
		})
	})

	it('rejects a current filename carrying another generation metadata', () => {
		const home = mkdtempSync(path.join(tmpdir(), HOME_PREFIX))
		const codex_home = path.join(home, '.codex')

		write_rollout_for(codex_home, TARGET, THREAD_ID, PREVIOUS_THREAD_ID)

		expect(codex_usage.measurement(TARGET, home, environment())).toBeUndefined()
	})
})

describe('codex_usage.measurement — rollout matching', () => {
	it('does not use a current thread that belongs to another project', () => {
		const home = mkdtempSync(path.join(tmpdir(), HOME_PREFIX))
		const codex_home = path.join(home, '.codex')

		write_rollout(codex_home, '/projects/other')

		expect(codex_usage.measurement(TARGET, home, environment())).toBeUndefined()
	})

	it('prefers the native CODEX_HOME without changing it', () => {
		const home = mkdtempSync(path.join(tmpdir(), HOME_PREFIX))

		write_rollout(home, TARGET)

		expect(
			codex_usage.measurement(TARGET, '/unused/default', {
				...environment(),
				CODEX_HOME: home,
			}),
		).toMatchObject({ billed_input_tokens: TOTAL_INPUT })
	})
})
