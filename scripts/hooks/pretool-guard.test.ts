import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { piped_verification } from '#scripts/rules/piped-verification'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pretool_guard, pretool_outcome, pretool_outcome_async } from './pretool-guard'
import { step_zero_notice } from './step-zero-notice'

// The watcher guard is the one composed rule that reads off disk, so it is mocked here to pin the
// composition — that a stale-watcher reason fills a clear verdict, and that a synchronous refusal wins
// over it (joshuafolkken/kit#2353). Its own detection is pinned in `run-watcher-hook.test.ts`.
vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: { parent_cut_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

const { lane_phase } = await import('#scripts/lane/lane-phase')
const mark_implement = vi.mocked(lane_phase.mark_implement)
const { run_watcher_hook } = await import('#scripts/run/run-watcher-hook')
const watcher_hook_reason = vi.mocked(run_watcher_hook.watcher_hook_reason)
const { run_parent_cut_hook } = await import('#scripts/run/run-parent-cut-hook')
const parent_cut_reason = vi.mocked(run_parent_cut_hook.parent_cut_reason)

const { combine_outcomes } = pretool_guard

const BENIGN_COMMAND = 'ls'
const SHELL_BODY_COMMAND = 'pnpm josh notify --body="hi `date`"'
const SHELL_BODY_REASON = 'shell-evaluated body'
const WATCHER_STALE_REASON = 'watcher stale'
const PARENT_CUT_REASON = 'parent hand-off'
const ALLOW_DECISION = '"permissionDecision":"allow"'

function outcome(
	reason: string | undefined,
	notice: string | undefined,
	fault: string | undefined,
): GuardOutcome {
	return { reason, notice, fault }
}

function in_lane(): boolean {
	return true
}

function outside_lane(): boolean {
	return false
}

// A real transcript file so the composed guards run their normal disk path rather than failing open,
// and a fresh one per case so the once-per-run stamp never dedupes one case against another.
function fresh_transcript(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pretool-guard-'))
	const transcript_path = path.join(directory, 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')
	closeSync(openSync(transcript_path, 'r'))

	return transcript_path
}

function payload_with_transcript(command: string): string {
	const transcript_path = fresh_transcript()

	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

// The same fresh transcript, carried by an `Edit` of a runtime file instead of a shell call.
function edit_payload_with_transcript(): string {
	const transcript_path = fresh_transcript()
	const file_path = path.join(process.cwd(), 'scripts/hooks/example.ts')

	return JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, transcript_path })
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

// joshuafolkken/kit#2994: the Step 0 reminder is the last layer, spoken only where nothing else did.
describe('pretool_outcome — the Step 0 reminder at Edit time', () => {
	afterEach(() => {
		watcher_hook_reason.mockReset()
		watcher_hook_reason.mockResolvedValue(undefined)
	})

	it('reminds on the first runtime edit of a session', async () => {
		const result = await pretool_outcome_async(edit_payload_with_transcript())

		expect(result).toEqual(outcome(undefined, step_zero_notice.NOTICE, undefined))
	})

	it('carries the reminder on the synchronous path the Codex adapter asks', () => {
		expect(pretool_outcome(edit_payload_with_transcript()).notice).toBe(step_zero_notice.NOTICE)
	})

	it('says nothing on a shell call', async () => {
		const result = await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(result.notice).toBeUndefined()
	})

	// joshuafolkken/kit#3444: the reminder's edit is the lane child's move from plan to code.
	it('marks the implement phase beside the reminder, and only then', async () => {
		mark_implement.mockClear()
		const payload = edit_payload_with_transcript()

		await pretool_outcome_async(payload)
		await pretool_outcome_async(payload)
		await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(mark_implement).toHaveBeenCalledOnce()
	})

	it('lets an asynchronous refusal win over the reminder', async () => {
		watcher_hook_reason.mockResolvedValue(WATCHER_STALE_REASON)

		const result = await pretool_outcome_async(edit_payload_with_transcript())

		expect(result).toEqual(outcome(WATCHER_STALE_REASON, undefined, undefined))
	})
})

// joshuafolkken/kit#3444: the Codex adapter marks the phase through the same helper.
describe('pretool_guard.mark_phase', () => {
	it('marks the implement phase from the reminder alone', async () => {
		mark_implement.mockClear()

		await pretool_guard.mark_phase(outcome(undefined, 'another notice', undefined))
		await pretool_guard.mark_phase(outcome(undefined, step_zero_notice.NOTICE, undefined))

		expect(mark_implement).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#2947: the parent hand-off guard is the second asynchronous rule, after the watcher.
describe('pretool_outcome_async — the composed parent hand-off guard', () => {
	afterEach(() => {
		watcher_hook_reason.mockReset()
		watcher_hook_reason.mockResolvedValue(undefined)
		parent_cut_reason.mockReset()
		parent_cut_reason.mockResolvedValue(undefined)
	})

	it('surfaces the parent hand-off refusal on a call everything else cleared', async () => {
		parent_cut_reason.mockResolvedValue(PARENT_CUT_REASON)

		const refusal = await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(refusal.reason).toBe(PARENT_CUT_REASON)
	})

	it('shows a stale watcher first, without consulting the parent guard', async () => {
		watcher_hook_reason.mockResolvedValue(WATCHER_STALE_REASON)
		parent_cut_reason.mockResolvedValue(PARENT_CUT_REASON)

		const refusal = await pretool_outcome_async(payload_with_transcript(BENIGN_COMMAND))

		expect(refusal.reason).toBe(WATCHER_STALE_REASON)
		expect(parent_cut_reason).not.toHaveBeenCalled()
	})

	it('keeps a synchronous refusal, without consulting the parent guard', async () => {
		const refusal = await pretool_outcome_async(payload_with_transcript(SHELL_BODY_COMMAND))

		expect(refusal.reason).toContain(SHELL_BODY_REASON)
		expect(parent_cut_reason).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3154: a lane child's backgrounded `josh ship` is run in the foreground instead of
// being refused, since a foreground ship detaches itself after its preflight.
describe('pretool_guard.foreground_rewrite', () => {
	const ship_payload = JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command: 'pnpm josh ship --detach "Title #1"', run_in_background: true },
		transcript_path: fresh_transcript(),
	})
	const clear = outcome(undefined, undefined, undefined)

	it('allows the call with the background flag cleared in a lane child', () => {
		const envelope = pretool_guard.foreground_rewrite(clear, ship_payload, in_lane) ?? ''

		expect(envelope).toContain(ALLOW_DECISION)
		expect(envelope).toContain('"run_in_background":false')
	})

	it('leaves a refusal from another guard in place', () => {
		const refused = outcome(SHELL_BODY_REASON, undefined, undefined)

		expect(pretool_guard.foreground_rewrite(refused, ship_payload, in_lane)).toBeUndefined()
	})

	it('rewrites nothing outside a lane child', () => {
		expect(pretool_guard.foreground_rewrite(clear, ship_payload, outside_lane)).toBeUndefined()
	})
})

// joshuafolkken/kit#3570: a josh check piped to a filter that reads to the end runs under `pipefail`
// instead of being refused, and the guards judge the call that will actually run.
const PIPED_LINT = 'pnpm josh lint:related 2>&1 | tail -5'
const PIPED_HEAD = 'pnpm josh lint:related 2>&1 | head -5'
const DENY_DECISION = '"permissionDecision":"deny"'
const { PIPED_VERIFICATION_REASON, PIPEFAIL_NOTE } = piped_verification

function payload_on(transcript_path: string, command: string): string {
	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

async function written(raw_payload: string): Promise<string> {
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await pretool_guard.respond(raw_payload)
	const text = write.mock.calls.map((call) => String(call[0])).join('')

	write.mockRestore()

	return text
}

describe('pretool_guard.respond — the pipefail rewrite', () => {
	it('allows a `| tail` check with `set -o pipefail;` prefixed and the note attached', async () => {
		const envelope = await written(payload_with_transcript(PIPED_LINT))

		expect(envelope).toContain(ALLOW_DECISION)
		expect(envelope).toContain(JSON.stringify(`set -o pipefail; ${PIPED_LINT}`))
		expect(envelope).toContain(JSON.stringify(PIPEFAIL_NOTE).slice(1, -1))
	})

	it('still refuses a `| head` check, and the rewrite before it spent no delivery', async () => {
		const transcript_path = fresh_transcript()

		await written(payload_on(transcript_path, PIPED_LINT))
		const envelope = await written(payload_on(transcript_path, PIPED_HEAD))

		expect(envelope).toContain(DENY_DECISION)
		expect(envelope).toContain(JSON.stringify(PIPED_VERIFICATION_REASON).slice(1, 40))
	})

	it('rewrites nothing while the rule guard is switched off', () => {
		vi.stubEnv(delivered_rules.SWITCH_ENV_KEY, 'off')
		const rewrite = pretool_guard.pipefail_rewrite(payload_with_transcript(PIPED_LINT))

		vi.unstubAllEnvs()

		expect(rewrite).toBeUndefined()
	})

	it('rewrites nothing for a call that runs no check', () => {
		expect(
			pretool_guard.pipefail_rewrite(payload_with_transcript('git log | tail')),
		).toBeUndefined()
	})
})

describe('pretool_guard.emit — the pipefail rewrite beside other guards', () => {
	it("lets another guard's refusal win over the rewrite", () => {
		const raw_payload = payload_with_transcript(PIPED_LINT)
		const rewrite = pretool_guard.pipefail_rewrite(raw_payload)
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		pretool_guard.emit(
			raw_payload,
			outcome(SHELL_BODY_REASON, undefined, undefined),
			rewrite?.input,
		)
		const envelope = write.mock.calls.map((call) => String(call[0])).join('')

		write.mockRestore()

		expect(rewrite).toBeDefined()
		expect(envelope).toContain(DENY_DECISION)
		expect(envelope).not.toContain('pipefail;')
	})

	it('refuses a check chained beside another command instead of allowing it', async () => {
		const envelope = await written(payload_with_transcript(`${PIPED_LINT} && rm -r dist`))

		expect(envelope).toContain(DENY_DECISION)
		expect(envelope).not.toContain(ALLOW_DECISION)
	})
})
