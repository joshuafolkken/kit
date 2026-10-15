import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import {
	investigation_notice_path,
	NOTICE,
	refusal_path,
	SWITCH_ENV_KEY,
} from '#scripts/delegation/investigation-guard'
import { hook_decision } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// joshuafolkken/kit#3877: in a lane child the investigation guard answers with a notice rather than a
// refusal, and `pretool:guard` used to keep only the refusal half — the notice spent its stamp and was
// never delivered. Pinned end to end through the one hook process, on a real transcript. A separate
// suite from `pretool-guard.test.ts`, which is at its length limit.

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: { parent_cut_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

const { pretool_guard } = await import('./pretool-guard')

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'pretool-guard-investigation-'))
const ENTRY_DIRECTORY = process.cwd()
const LANE_ISSUE = '3877'
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const WRITTEN_TRANSCRIPTS: Array<string> = []
const UNSET = ''

function at_threshold_lines(): Array<string> {
	const files = Array.from(
		{ length: delegation_policy.INVESTIGATION_FILE_THRESHOLD - 1 },
		(_unused, index) => `scripts/read-${String(index)}.ts`,
	)

	return time_transcript_fixture.target_turn_lines(0, files)
}

function write_transcript(name: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, at_threshold_lines().join('\n'))
	WRITTEN_TRANSCRIPTS.push(target)

	return target
}

function read_payload(transcript_path: string): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path,
		tool_name: 'Read',
		tool_input: { file_path: 'scripts/next.ts' },
	})
}

async function written(raw_payload: string): Promise<string> {
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await pretool_guard.respond(raw_payload)
	const text = write.mock.calls.map((call) => String(call[0])).join('')

	write.mockRestore()

	return text
}

const envelope_schema = z.object({
	hookSpecificOutput: z.object({ additionalContext: z.string() }),
})

function additional_context(text: string): string | undefined {
	return json_value.parse_with(text, envelope_schema)?.hookSpecificOutput.additionalContext
}

// The mark and the checkout are set up exactly as `investigation-guard.test.ts` sets up its lane case.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = UNSET
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	process.chdir(LANE_DIRECTORY)
	process.env[lane_child_marker.KEY] = LANE_ISSUE
})

afterEach(() => {
	process.chdir(ENTRY_DIRECTORY)
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(refusal_path(transcript), { force: true })
		rmSync(investigation_notice_path(transcript), { force: true, recursive: true })
	}

	rmSync(WORK_DIRECTORY, { force: true, recursive: true })
})

describe('pretool:guard — the investigation guard in a lane child', () => {
	it('delivers the notice as additional context, with no refusal', async () => {
		const text = await written(read_payload(write_transcript('notice')))

		expect(text).not.toContain('permissionDecision')
		expect(additional_context(text)).toContain(NOTICE)
	})

	// A notice stamp that cannot be written withholds the notice and reports the fault instead.
	it('delivers the fault when the notice stamp cannot be written', async () => {
		const transcript = write_transcript('fault')

		mkdirSync(investigation_notice_path(transcript), { recursive: true })

		const text = await written(read_payload(transcript))

		expect(additional_context(text)).toBe(hook_decision.stamp_fault(SWITCH_ENV_KEY))
	})
})
