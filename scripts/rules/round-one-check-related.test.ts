import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { round_one_check_related } from './round-one-check-related'

const RULE_ID = 'round-one-check-related'
const ISSUE = '5205'
const { BRANCH } = time_transcript_fixture
const CHECK = 'pnpm josh check:related'
const REASON = round_one_check_related.ROUND_ONE_CHECK_RELATED_REASON
const BRIEF_LINE = time_transcript_fixture.josh_call_line(
	1,
	BRANCH,
	'pnpm josh run:review',
	'brief',
)
const FIX_LINE = time_transcript_fixture.edit_call_line(2, BRANCH, 'scripts/a.ts', 'fix')
const JOIN_LINE = time_transcript_fixture.josh_call_line(3, BRANCH, 'pnpm josh run:review --join')
const DETACH_LINE = time_transcript_fixture.josh_call_line(
	3,
	BRANCH,
	'pnpm josh ship --detach --review "Title #5205"',
)
const OPEN_ROUND = [BRIEF_LINE, FIX_LINE].join('\n')

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'round-one-check-related-'))
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

describe('round_one_check_related.fixes_an_open_round', () => {
	it('answers true for a fix after the brief', () => {
		expect(round_one_check_related.fixes_an_open_round(OPEN_ROUND)).toBe(true)
	})

	it('answers false for a brief with no fix', () => {
		expect(round_one_check_related.fixes_an_open_round(BRIEF_LINE)).toBe(false)
	})

	it('answers false once the review is joined', () => {
		expect(round_one_check_related.fixes_an_open_round(`${OPEN_ROUND}\n${JOIN_LINE}`)).toBe(false)
	})

	it('answers false once the ship is detached', () => {
		expect(round_one_check_related.fixes_an_open_round(`${OPEN_ROUND}\n${DETACH_LINE}`)).toBe(false)
	})

	it('answers false for an edit before any brief', () => {
		expect(round_one_check_related.fixes_an_open_round(`${FIX_LINE}\n${BRIEF_LINE}`)).toBe(false)
	})

	it('reads a pinned read of the running check as no brief', () => {
		const pinned = time_transcript_fixture.josh_call_line(
			1,
			BRANCH,
			'pnpm josh run:review --pinned',
		)

		expect(round_one_check_related.fixes_an_open_round(`${pinned}\n${FIX_LINE}`)).toBe(false)
	})
})

function enter_lane_child(): void {
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	process.chdir(LANE_DIRECTORY)
	process.env[lane_child_marker.KEY] = ISSUE
}

describe('the round-one-check-related delivery in a lane child — refused', () => {
	beforeEach(enter_lane_child)

	it('refuses check:related on a fixed round before the join', () => {
		expect(delivered_rules.delivery(payload_of('open', CHECK, OPEN_ROUND))).toBe(REASON)
	})

	it('refuses the `cr` alias on every occurrence', () => {
		const payload = payload_of('alias', 'pnpm josh cr', OPEN_ROUND)

		expect(delivered_rules.delivery(payload)).toBe(REASON)
		expect(delivered_rules.delivery(payload)).toBe(REASON)
	})

	it('refuses check:related behind `set -o pipefail` and in front of a pipe', () => {
		const command = 'set -o pipefail; pnpm josh check:related 2>&1 | grep -E "error"'

		expect(delivered_rules.delivery(payload_of('piped', command, OPEN_ROUND))).toBe(REASON)
	})
})

describe('the round-one-check-related delivery — let through', () => {
	it('lets check:related through after the join', () => {
		enter_lane_child()

		const tail = `${OPEN_ROUND}\n${JOIN_LINE}`

		expect(delivered_rules.delivery(payload_of('joined', CHECK, tail))).toBeUndefined()
	})

	it('lets check:related through on a round with no fix', () => {
		enter_lane_child()

		expect(delivered_rules.delivery(payload_of('unfixed', CHECK, BRIEF_LINE))).toBeUndefined()
	})

	it('lets check:related through outside a lane child', () => {
		expect(delivered_rules.delivery(payload_of('person', CHECK, OPEN_ROUND))).toBeUndefined()
	})
})
