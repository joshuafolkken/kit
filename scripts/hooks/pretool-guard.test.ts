import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { describe, expect, it } from 'vitest'
import { pretool_guard, pretool_outcome } from './pretool-guard'

const { combine_outcomes } = pretool_guard

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
		expect(pretool_outcome(payload_with_transcript('ls')).reason).toBeUndefined()
	})

	it('surfaces a rule-guard refusal through the one consolidated process', () => {
		const refusal = pretool_outcome(payload_with_transcript('pnpm josh notify --body="hi `date`"'))

		expect(refusal.reason).toContain('shell-evaluated body')
	})
})
