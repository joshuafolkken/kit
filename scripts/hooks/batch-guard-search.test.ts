import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SWITCH_ENV_KEY as INVESTIGATION_SWITCH } from '#scripts/delegation/investigation-guard'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { batch_refusal } from './batch-guard'

// kit#5342: in a dispatched lane child the general batching rule is off, and only a chain of
// single-call searches is refused — standing aside where the investigation guard refuses the same call.
// A separate suite from `batch-guard.test.ts`, which is at its length limit.

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'batch-guard-search-'))
const ENTRY_DIRECTORY = process.cwd()
const LANE_ISSUE = '5342'
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const { bash_turn_lines, ms } = time_transcript_fixture
const NOW_MS = ms(59)
const GREP = 'grep -n mode_here scripts/lane/lane-guard-policy.ts'
const SWITCHED_OFF = '0'

function payload_of(name: string, commands: ReadonlyArray<string>): string {
	const turns = commands.map((command, turn) => bash_turn_lines(turn, command))
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(
		target,
		[...turns.flat(), ...bash_turn_lines(commands.length, GREP, false)].join('\n'),
	)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: target,
		tool_name: 'Bash',
		tool_input: { command: GREP },
	})
}

const SEARCHES = ['grep -n refuse scripts/hooks/batch-guard.ts', 'rg density tools/cost-audit/']

beforeEach(() => {
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	process.chdir(LANE_DIRECTORY)
	process.env[lane_child_marker.KEY] = LANE_ISSUE
})

afterEach(() => {
	process.chdir(ENTRY_DIRECTORY)
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	Reflect.deleteProperty(process.env, INVESTIGATION_SWITCH)
})

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('batch_refusal — the search chain a lane child is still refused for', () => {
	it('refuses a third single-call search while the investigation guard stays silent', () => {
		process.env[INVESTIGATION_SWITCH] = SWITCHED_OFF

		expect(batch_refusal(payload_of('lane-search', SEARCHES), NOW_MS)).toContain('batching')
	})

	// Only one reason surfaces per call; the investigation refusal is the one that names delegation, so
	// the search refusal steps aside rather than spend that guard's stamp unseen.
	it('stands aside where the investigation guard refuses the same call', () => {
		expect(batch_refusal(payload_of('lane-search-investigated', SEARCHES), NOW_MS)).toBeUndefined()
	})

	it('lets a chain through when an earlier turn read a file rather than searched', () => {
		process.env[INVESTIGATION_SWITCH] = SWITCHED_OFF
		const commands = ['cat scripts/hooks/batch-guard.ts', SEARCHES[1] ?? GREP]

		expect(batch_refusal(payload_of('lane-read-then-search', commands), NOW_MS)).toBeUndefined()
	})
})
