import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { run_ending } from '#scripts/run/run-ending'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch_log } from './lane-dispatch-log'
import { lane_dispatch_prepare } from './lane-dispatch-prepare'
import type { LaneInfo } from './lane-registry'

const ISSUE = '7349'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-prepare-lane`)
const SESSION = '5b0c1f3e-2a4d-4e8f-9a61-7c3d2e1f0a9b'
const OUTAGE_LINE = JSON.stringify({
	type: 'result',
	is_error: true,
	result: 'The socket connection was closed unexpectedly',
	session_id: SESSION,
})

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory: LANE_DIRECTORY,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const LOG_PATH = lane_dispatch_log.default_log_path(lane())

function write_outage_log(): void {
	mkdirSync(path.dirname(LOG_PATH), { recursive: true })
	writeFileSync(LOG_PATH, `${OUTAGE_LINE}\n`, 'utf8')
}

beforeEach(() => {
	// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(LOG_PATH, { force: true })
})

describe('lane_dispatch_prepare.prepared', () => {
	it('starts fresh without reading the exit record when asked for a fresh session', () => {
		write_outage_log()
		const read_exit = vi.spyOn(run_ending, 'read_exit')
		const outcome = lane_dispatch_prepare.prepared(lane(), true)

		expect(read_exit).not.toHaveBeenCalled()
		expect(outcome).toMatchObject({ kind: 'prepared', invocation: `fullrun #${ISSUE}` })
		expect(outcome).toHaveProperty('resumed_from', undefined)
	})

	it('resumes the session an outage record in the lane log names', () => {
		write_outage_log()
		const outcome = lane_dispatch_prepare.prepared(lane(), false)

		expect(outcome).toMatchObject({ kind: 'prepared', resumed_from: SESSION })
	})

	it('starts fresh when the lane log holds no exit record', () => {
		const outcome = lane_dispatch_prepare.prepared(lane(), false)

		expect(outcome).toMatchObject({ kind: 'prepared', resumed_from: undefined })
	})

	it('passes a rejected worker profile through unchanged', () => {
		const rejected = { kind: 'rejected', note: 'no such provider' } as const

		vi.spyOn(agent_role_profile, 'resolve').mockReturnValue(rejected)

		expect(lane_dispatch_prepare.prepared(lane(), false)).toStrictEqual(rejected)
	})
})
