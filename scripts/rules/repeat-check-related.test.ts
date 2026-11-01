import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { repeat_check_related } from './repeat-check-related'

const RULE_ID = 'repeat-check-related'
const ISSUE = '5764'
const { BRANCH } = time_transcript_fixture
const CHECK = 'pnpm josh check:related'
const REASON = repeat_check_related.REPEAT_CHECK_RELATED_REASON
const CHECK_ID = 'check'
const CHECK_LINE = [
	time_transcript_fixture.josh_call_line(1, BRANCH, CHECK, CHECK_ID),
	time_transcript_fixture.error_result_line(2, BRANCH, CHECK_ID, '✖ lint:related failed'),
].join('\n')
const PENDING_LINE = time_transcript_fixture.josh_call_line(4, BRANCH, CHECK, 'pending')
const FIX_LINE = time_transcript_fixture.edit_call_line(2, BRANCH, 'scripts/a.ts', 'fix')
const BRIEF_LINE = time_transcript_fixture.josh_call_line(
	3,
	BRANCH,
	'pnpm josh run:review',
	'brief',
)
const DETACH_LINE = time_transcript_fixture.josh_call_line(
	3,
	BRANCH,
	'pnpm josh ship --detach --review "Title #5764"',
)
const CHECKED_AND_FIXED = [CHECK_LINE, FIX_LINE].join('\n')

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'repeat-check-related-'))
const ENTRY_DIRECTORY = process.cwd()
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

function payload_of(name: string, command: string, tail: string): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, tail)
	WRITTEN_TRANSCRIPTS.add(transcript)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name: 'Bash',
		tool_input: { command },
	})
}

function enter_lane_child(): void {
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	process.chdir(LANE_DIRECTORY)
	process.env[lane_child_marker.KEY] = ISSUE
}

beforeEach(() => {
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	process.chdir(WORK_DIRECTORY)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)

	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(RULE_ID, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('repeat_check_related.repeats_before_brief', () => {
	it('answers true for a check:related already run with no brief since', () => {
		expect(repeat_check_related.repeats_before_brief(CHECKED_AND_FIXED)).toBe(true)
	})

	it('answers false for a tail with no check:related', () => {
		expect(repeat_check_related.repeats_before_brief(FIX_LINE)).toBe(false)
	})

	it('answers false once a brief follows the check', () => {
		const tail = `${CHECKED_AND_FIXED}\n${BRIEF_LINE}`

		expect(repeat_check_related.repeats_before_brief(tail)).toBe(false)
	})

	it('restarts the count at run:review --join', () => {
		const join = time_transcript_fixture.josh_call_line(3, BRANCH, 'pnpm josh run:review --join')
		const tail = `${CHECKED_AND_FIXED}\n${join}\n${FIX_LINE}`

		expect(repeat_check_related.repeats_before_brief(tail)).toBe(false)
	})

	it('restarts the count at ship --detach', () => {
		const tail = `${CHECKED_AND_FIXED}\n${DETACH_LINE}\n${FIX_LINE}`

		expect(repeat_check_related.repeats_before_brief(tail)).toBe(false)
	})

	it('reads the `cr` alias as a check:related', () => {
		const alias = [
			time_transcript_fixture.josh_call_line(1, BRANCH, 'pnpm josh cr', CHECK_ID),
			time_transcript_fixture.result_line(2, BRANCH, CHECK_ID),
		].join('\n')

		expect(repeat_check_related.repeats_before_brief(alias)).toBe(true)
	})
})

describe('repeat_check_related.repeats_before_brief — calls that did not run', () => {
	it('does not count the call being decided, which has no result yet', () => {
		expect(repeat_check_related.repeats_before_brief(`${FIX_LINE}\n${PENDING_LINE}`)).toBe(false)
	})

	it('does not count a check:related another guard refused', () => {
		const refused = [
			time_transcript_fixture.josh_call_line(1, BRANCH, CHECK, CHECK_ID),
			time_transcript_fixture.error_result_line(2, BRANCH, CHECK_ID, '⛔ batching: reissue'),
		].join('\n')

		expect(repeat_check_related.repeats_before_brief(`${refused}\n${PENDING_LINE}`)).toBe(false)
	})
})

describe('the repeat-check-related delivery in a lane child', () => {
	beforeEach(enter_lane_child)

	it('refuses a mid-run full-reach check:related on every occurrence', () => {
		const payload = payload_of('repeat', CHECK, CHECKED_AND_FIXED)

		expect(delivered_rules.delivery(payload)).toBe(REASON)
		expect(delivered_rules.delivery(payload)).toBe(REASON)
	})

	it('lets the first check:related through', () => {
		expect(delivered_rules.delivery(payload_of('first', CHECK, FIX_LINE))).toBeUndefined()
	})

	// joshuafolkken/kit#5784: the touched run is the mid-run check the refusal points to.
	it('lets a mid-run check:related --touched through, and names it in the refusal', () => {
		const command = 'pnpm josh check:related --touched'

		expect(
			delivered_rules.delivery(payload_of('touched-check', command, CHECKED_AND_FIXED)),
		).toBeUndefined()
		expect(REASON).toContain('`pnpm josh check:related --touched`')
	})

	it('does not count an earlier check:related --touched as the run before the brief', () => {
		const touched = [
			time_transcript_fixture.josh_call_line(1, BRANCH, `${CHECK} --touched`, CHECK_ID),
			time_transcript_fixture.result_line(2, BRANCH, CHECK_ID),
		].join('\n')

		expect(delivered_rules.delivery(payload_of('after-touched', CHECK, touched))).toBeUndefined()
	})

	it('lets a by-name test:related --touched through', () => {
		const command = 'pnpm josh test:related --touched'

		expect(
			delivered_rules.delivery(payload_of('touched', command, CHECKED_AND_FIXED)),
		).toBeUndefined()
	})
})

describe('the repeat-check-related delivery outside a lane child', () => {
	it('lets a repeated check:related through', () => {
		expect(delivered_rules.delivery(payload_of('person', CHECK, CHECKED_AND_FIXED))).toBeUndefined()
	})
})
