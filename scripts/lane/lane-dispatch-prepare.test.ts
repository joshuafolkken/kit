import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { run_ending } from '#scripts/run/run-ending'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch_log } from './lane-dispatch-log'
import { lane_dispatch_prepare } from './lane-dispatch-prepare'
import type { LaneInfo } from './lane-registry'

const ISSUE = '7349'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-prepare-lane`)
const MANIFEST_PATH = path.join(LANE_DIRECTORY, PACKAGE_JSON)
const HAIKU = { name: 'haiku', model: 'claude-haiku-5-5', effort: 'low', when: 'Mechanical work' }
const SONNET = { name: 'sonnet', model: 'claude-sonnet-5-5', effort: 'medium', when: 'A brief' }
const WORKER = { default: SONNET.name, profiles: [HAIKU, SONNET] }
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

function write_worker_setting(): void {
	mkdirSync(LANE_DIRECTORY, { recursive: true })
	writeFileSync(MANIFEST_PATH, JSON.stringify({ name: 'app', josh: { worker: WORKER } }), 'utf8')
}

function mock_labels(labels: Array<string> | undefined): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(git_gh_issue_write, 'read_label_names').mockResolvedValue(labels)
}

beforeEach(() => {
	// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(LOG_PATH, { force: true })
	rmSync(MANIFEST_PATH, { force: true })
})

describe('lane_dispatch_prepare.prepared', () => {
	it('starts fresh without reading the exit record when asked for a fresh session', async () => {
		write_outage_log()
		const read_exit = vi.spyOn(run_ending, 'read_exit')
		const outcome = await lane_dispatch_prepare.prepared(lane(), true)

		expect(read_exit).not.toHaveBeenCalled()
		expect(outcome).toMatchObject({ kind: 'prepared', invocation: `fullrun #${ISSUE}` })
		expect(outcome).toHaveProperty('resumed_from', undefined)
	})

	it('resumes the session an outage record in the lane log names', async () => {
		write_outage_log()
		const outcome = await lane_dispatch_prepare.prepared(lane(), false)

		expect(outcome).toMatchObject({ kind: 'prepared', resumed_from: SESSION })
	})

	it('starts fresh when the lane log holds no exit record', async () => {
		const outcome = await lane_dispatch_prepare.prepared(lane(), false)

		expect(outcome).toMatchObject({ kind: 'prepared', resumed_from: undefined })
	})

	it('passes a rejected worker profile through unchanged', async () => {
		const rejected = { kind: 'rejected', note: 'no such provider' } as const

		vi.spyOn(agent_role_profile, 'resolve').mockReturnValue(rejected)

		expect(await lane_dispatch_prepare.prepared(lane(), false)).toStrictEqual(rejected)
	})
})

describe('lane_dispatch_prepare.prepared — the josh.worker profile', () => {
	it('launches on the profile the worker label names, over JOSH_WORKER_MODEL', async () => {
		write_worker_setting()
		mock_labels(['enhancement', `worker:${HAIKU.name}`])
		vi.stubEnv('JOSH_WORKER_MODEL', 'claude-opus-5-5')
		vi.stubEnv('JOSH_WORKER_EFFORT', 'high')
		const outcome = await lane_dispatch_prepare.prepared(lane(), true)

		expect(outcome).toMatchObject({
			kind: 'prepared',
			profile: { model: HAIKU.model, effort: 'low' },
		})
	})

	it('refuses the launch when the Issue labels cannot be read', async () => {
		write_worker_setting()
		mock_labels(undefined)
		const outcome = await lane_dispatch_prepare.prepared(lane(), true)

		expect(outcome.kind === 'rejected' ? outcome.note : '').toContain(
			'could not read the Issue labels',
		)
	})

	it('keeps the environment argv byte for byte and reads no labels without the setting', async () => {
		const read_labels = mock_labels([`worker:${HAIKU.name}`])
		const resolved = agent_role_profile.resolve(agent_role_profile.WORKER)
		if (resolved.kind === 'rejected') throw new Error(resolved.note)
		const before = agent_argv.with_profile_in(`fullrun #${ISSUE}`, resolved.profile, LANE_DIRECTORY)
		const outcome = await lane_dispatch_prepare.prepared(lane(), true)

		expect(outcome.kind === 'prepared' ? outcome.argv : undefined).toStrictEqual(
			before.kind === 'rejected' ? before.note : before.argv,
		)
		expect(read_labels).not.toHaveBeenCalled()
	})
})
