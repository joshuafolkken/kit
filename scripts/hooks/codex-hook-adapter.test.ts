import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hook_decision, type GuardOutcome } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_bundle_call } from '#scripts/time-runtime/time-bundle-call'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { codex_hook_adapter } from './codex-hook-adapter'
import { format_edited_file, parse_edited_path, type CommandRunner } from './format-edited-file'
import { pretool_guard } from './pretool-guard'

const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'codex-hook-adapter-'))
const TYPESCRIPT_FILE = path.join(TEST_DIRECTORY, 'app.ts')
const MARKDOWN_FILE = path.join(TEST_DIRECTORY, 'notes.md')
const THIRD_FILE = path.join(TEST_DIRECTORY, 'third.json')
const ALLOW: GuardOutcome = { reason: undefined, notice: undefined, fault: undefined }
const { open_turn_lines, target_turn_lines } = time_transcript_fixture

writeFileSync(TYPESCRIPT_FILE, 'export const value = 1\n')
writeFileSync(MARKDOWN_FILE, '# Notes\n')

afterAll(() => {
	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
})

function patch_command(paths: ReadonlyArray<string>): string {
	const changes = paths.map((file_path) => `*** Update File: ${file_path}`).join('\n')

	return `*** Begin Patch\n${changes}\n*** End Patch`
}

function codex_payload(paths: ReadonlyArray<string>): string {
	return JSON.stringify({
		session_id: 'session-1',
		transcript_path: path.join(TEST_DIRECTORY, 'transcript.jsonl'),
		cwd: TEST_DIRECTORY,
		hook_event_name: 'PreToolUse',
		turn_id: 'turn-1',
		tool_name: 'apply_patch',
		tool_use_id: 'call-1',
		tool_input: { command: patch_command(paths) },
	})
}

function adapted_call(paths: ReadonlyArray<string>): GuardedCall {
	const payload = hook_decision.parse_hook_payload(
		codex_hook_adapter.pretool_payload(codex_payload(paths)),
	)
	if (payload === undefined) throw new Error('Adapter returned an invalid guard payload')

	return { name: payload.tool_name, input: payload.tool_input }
}

function unbatched_text(second_target = 'b.ts'): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, [second_target]),
		...open_turn_lines(2, ['c.ts']),
	].join('\n')
}

describe('Codex pre-tool adaptation', () => {
	it('runs the canonical guard with an Edit payload for one patched file', () => {
		const guard = vi.spyOn(pretool_guard, 'pretool_outcome').mockReturnValue(ALLOW)

		codex_hook_adapter.pretool_outcome(codex_payload([TYPESCRIPT_FILE]))

		expect(guard).toHaveBeenCalledOnce()

		expect(hook_decision.parse_hook_payload(guard.mock.calls[0]?.[0] ?? '')).toMatchObject({
			tool_name: 'Edit',
			tool_input: { file_path: TYPESCRIPT_FILE },
		})
	})

	it('preserves every patch target on the refusing edit path', () => {
		const paths = [TYPESCRIPT_FILE, MARKDOWN_FILE]
		const call = adapted_call(paths)

		expect(call.name).toBe('Edit')
		expect(time_bundle_call.call_facts(call.name, call.input).targets).toStrictEqual(paths)
		expect(time_batch_guard.should_block(unbatched_text(), call, 0)).toBe(true)
	})

	it('withholds refusal when history shares the second patch target', () => {
		const call = adapted_call([TYPESCRIPT_FILE, MARKDOWN_FILE])

		expect(time_batch_guard.should_block(unbatched_text(MARKDOWN_FILE), call, 0)).toBe(false)
	})
})

describe('Codex post-tool adaptation', () => {
	it('runs the canonical formatter plan for every patched file', async () => {
		const formatted: Array<string> = []

		const runner: CommandRunner = async (command) => {
			formatted.push(command.command_arguments.at(-1) ?? '')

			return { exit_code: 0, did_write_stdout: false }
		}

		const formatter = async (raw_payload: string, project_root: string): Promise<void> => {
			await format_edited_file(raw_payload, runner, project_root)
		}

		await codex_hook_adapter.format_posttool_payloads(
			codex_payload([TYPESCRIPT_FILE, MARKDOWN_FILE]),
			TEST_DIRECTORY,
			formatter,
		)

		expect(formatted).toContain(TYPESCRIPT_FILE)
		expect(formatted).toContain(MARKDOWN_FILE)
	})

	it('leaves a non-patch hook payload unchanged', () => {
		const raw_payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })

		expect(codex_hook_adapter.posttool_payloads(raw_payload)).toStrictEqual([raw_payload])
	})
})

describe('Codex post-tool formatting budget', () => {
	it('finishes the bounded files already started and starts no later file', async () => {
		const started: Array<string> = []
		const finished: Array<string> = []
		const releases: Array<() => void> = []

		const formatter = async (raw_payload: string): Promise<void> => {
			started.push(parse_edited_path(raw_payload) ?? '')
			await new Promise<void>((resolve) => {
				releases.push(resolve)
			})
			finished.push(parse_edited_path(raw_payload) ?? '')
		}

		const run = codex_hook_adapter.format_posttool_payloads(
			codex_payload([TYPESCRIPT_FILE, MARKDOWN_FILE, THIRD_FILE]),
			TEST_DIRECTORY,
			formatter,
		)

		expect(started).toStrictEqual([TYPESCRIPT_FILE, MARKDOWN_FILE])
		for (const release of releases) release()
		await run

		expect(finished).toStrictEqual(started)
		expect(started).not.toContain(THIRD_FILE)
	})
})
