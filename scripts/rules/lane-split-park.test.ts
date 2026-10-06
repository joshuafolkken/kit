import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_split_park } from './lane-split-park'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#3296: the lane child for #3255 promoted its Issue to an epic mid-run, then applied
// `needs-decision` to that epic and sent a `confirmation` Telegram. This suite pins the refusal of both
// acts onto the epic once the run has promoted the dispatched issue, and the silence everywhere else —
// a run that promoted nothing, either act onto another issue, and a person working in a lane.

const BASH = 'Bash'
const RULE_ID = 'lane-split-park'
const ISSUE = '3255'
const PROMOTE_COMMAND = `pnpm josh epic --promote ${ISSUE} --ordered 3291 3292`
const EPIC_LABEL_COMMAND = `gh api repos/joshuafolkken/kit/issues/${ISSUE}/labels -f 'labels[]=needs-decision'`
const EDIT_LABEL_COMMAND = `gh issue edit ${ISSUE} --add-label needs-decision`
const CHILD_LABEL_COMMAND =
	"gh api repos/joshuafolkken/kit/issues/3291/labels -f 'labels[]=needs-decision'"
const NOTIFY_COMMAND = `pnpm josh notify --task-type confirmation --issue-url 'https://github.com/joshuafolkken/kit/issues/${ISSUE}' --body='run it?'`
const CHILD_NOTIFY_COMMAND =
	"pnpm josh notify --task-type confirmation --issue-url 'https://github.com/joshuafolkken/kit/issues/3291' --body='x'"
const PROMOTE_MINUTE = 1
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const REASON = lane_split_park.LANE_SPLIT_PARK_REASON
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-split-park-'))
const ENTRY_DIRECTORY = process.cwd()
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()
const PROMOTE_LINE = time_transcript_fixture.tool_call_line(
	PROMOTE_MINUTE,
	time_transcript_fixture.BRANCH,
	{ name: BASH, input: { command: PROMOTE_COMMAND }, id: 'promote' },
)

function payload_of(name: string, command: string, tail: string): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, tail)
	WRITTEN_TRANSCRIPTS.add(transcript)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name: BASH,
		tool_input: { command },
	})
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
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

describe('promoted_issues', () => {
	it('reads the issue a josh epic --promote promoted', () => {
		expect(lane_split_park.promoted_issues([PROMOTE_COMMAND])).toEqual(new Set([ISSUE]))
	})

	it('reads a promote in a later segment of one shell line', () => {
		expect(lane_split_park.promoted_issues([`git status && ${PROMOTE_COMMAND}`])).toEqual(
			new Set([ISSUE]),
		)
	})

	it.each([
		['an epic --add', 'pnpm josh epic --add 3255 3291'],
		['a promote quoted in a body', `gh issue comment 1 --body "${PROMOTE_COMMAND}"`],
	])('reads nothing from %s', (_name, command) => {
		expect(lane_split_park.promoted_issues([command]).size).toBe(0)
	})
})

describe('rule_delivery — a lane child that promoted its own issue', () => {
	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		process.env[lane_child_marker.KEY] = ISSUE
	})

	// The notify is the measured leak: lane-park's refusal is once per run, so its reissue went out.
	it.each([
		['the REST label write onto the epic', EPIC_LABEL_COMMAND],
		['the gh issue edit label write onto the epic', EDIT_LABEL_COMMAND],
		['the confirmation notify about the epic', NOTIFY_COMMAND],
	])('refuses %s on every reissue', (name, command) => {
		const payload = payload_of(`split-${name}`, command, PROMOTE_LINE)

		expect(rule_delivery(payload, NOW_MS)).toBe(REASON)
		expect(rule_delivery(payload, A_LATER_CALL_MS)).toBe(REASON)
	})

	// The leftover child is the one issue the procedure does park after a split.
	it('leaves a label write onto another issue alone', () => {
		const payload = payload_of('split-child-label', CHILD_LABEL_COMMAND, PROMOTE_LINE)

		expect(rule_delivery(payload, NOW_MS)).not.toBe(REASON)
	})

	it('leaves the notify about the leftover child to lane-park', () => {
		const payload = payload_of('split-child-notify', CHILD_NOTIFY_COMMAND, PROMOTE_LINE)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.LANE_PARK_REASON)
	})

	it.each([
		['the label write', EPIC_LABEL_COMMAND],
		['the notify', NOTIFY_COMMAND],
	])('says nothing about %s when the run promoted nothing', (name, command) => {
		expect(rule_delivery(payload_of(`no-split-${name}`, command, ''), NOW_MS)).not.toBe(REASON)
	})
})

describe('rule_delivery — a person working in a lane', () => {
	it('says nothing without the dispatch mark', () => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)

		const payload = payload_of('person', EPIC_LABEL_COMMAND, PROMOTE_LINE)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})

describe('LANE_SPLIT_PARK_REASON', () => {
	it.each([
		['a split is not a park'],
		['`needs-decision`'],
		['`confirmation` Telegram'],
		['backlogrun-park.md` → "Splitting a child mid-run"'],
		['every occurrence'],
	])('carries %j', (marker) => {
		expect(REASON).toContain(marker)
	})
})
