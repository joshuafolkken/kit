import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pretool_guard, pretool_outcome, pretool_outcome_async } from './pretool-guard'

// The watcher guard is the one composed rule that reads off disk, so it is mocked here to pin the
// composition — that a stale-watcher reason fills a clear verdict, and that a synchronous refusal wins
// over it (joshuafolkken/kit#2353). Its own detection is pinned in `run-watcher-hook.test.ts`.
vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

const { run_watcher_hook } = await import('#scripts/run/run-watcher-hook')
const watcher_hook_reason = vi.mocked(run_watcher_hook.watcher_hook_reason)

const { combine_outcomes } = pretool_guard

const BENIGN_COMMAND = 'ls'
const SHELL_BODY_COMMAND = 'pnpm josh notify --body="hi `date`"'
const SHELL_BODY_REASON = 'shell-evaluated body'
const WATCHER_STALE_REASON = 'watcher stale'

function outcome(
	reason: string | undefined,
	notice: string | undefined,
	fault: string | undefined,
): GuardOutcome {
	return { reason, notice, fault }
}

// A real transcript file so the composed guards run their normal disk path rather than failing open,
// and a fresh one per case so the once-per-run stamp never dedupes one case against another.
function payload_with_transcript(command: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pretool-guard-'))
	const transcript_path = path.join(directory, 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')
	closeSync(openSync(transcript_path, 'r'))

	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

describe('combine_outcomes', () => {
	it('shows the batch reason first, over any other refusal', () => {
		const batch = outcome('batch refused', undefined, undefined)

		expect(combine_outcomes(batch, 'other refused')).toEqual(batch)
	})

	it('surfaces the extra refusal when the batch guard did not refuse', () => {
		const batch = outcome(undefined, undefined, undefined)
		const rule_refusal = 'rule refused'

		expect(combine_outcomes(batch, rule_refusal)).toEqual(
			outcome(rule_refusal, undefined, undefined),
		)
	})

	it('passes the batch notice through when nothing refuses', () => {
		const batch = outcome(undefined, 'whole-file notice', undefined)

		expect(combine_outcomes(batch, undefined)).toEqual(batch)
	})

	it('passes the batch fault through when nothing refuses', () => {
		const batch = outcome(undefined, undefined, 'could not read transcript')

		expect(combine_outcomes(batch, undefined)).toEqual(batch)
	})
})

describe('pretool_outcome', () => {
	it('allows a benign call that trips none of the three guards', () => {
		expect(pretool_outcome(payload_with_transcript(BENIGN_COMMAND)).reason).toBeUndefined()
	})

	it('surfaces a rule-guard refusal through the one consolidated process', () => {
		const refusal = pretool_outcome(payload_with_transcript(SHELL_BODY_COMMAND))

		expect(refusal.reason).toContain(SHELL_BODY_REASON)
	})
})

describe('pretool_outcome_async — the composed watcher guard', () => {
	afterEach(() => {
		watcher_hook_reason.mockReset()
		watcher_hook_reason.mockResolvedValue(undefined)
	})

	it('surfaces the watcher refusal on a call the synchronous guards cleared', async () => {
		watcher_hook_reason.mockResolvedValue(WATCHER_STALE_REASON)

		const refusal = await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(refusal.reason).toBe(WATCHER_STALE_REASON)
	})

	it('leaves a benign call clear when the watcher is fresh', async () => {
		const result = await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(result.reason).toBeUndefined()
	})

	it('keeps a synchronous refusal, without consulting the watcher', async () => {
		const refusal = await pretool_outcome_async(payload_with_transcript(SHELL_BODY_COMMAND))

		expect(refusal.reason).toContain(SHELL_BODY_REASON)
		expect(watcher_hook_reason).not.toHaveBeenCalled()
	})
})
