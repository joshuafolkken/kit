import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch } from './lane-dispatch'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'

// joshuafolkken/kit#3591: a launch that never started took `in-progress` back off by the canonical
// spelling and swallowed the failure, so a label stored as `In-Progress` answered 404 and stayed on an
// issue nothing was running, with no trace. The removal is the shared one now, unmocked here.

const ISSUE = '3591'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
const LOG_PATH = path.join(os.tmpdir(), `josh-lane-dispatch-${ISSUE}.log`)
// GitHub keeps the casing a label was created with.
const CREATED_CASING = 'In-Progress'

const read_labels = vi.spyOn(git_gh_command, 'issue_get_labels_and_body')
const remove_label = vi.spyOn(git_gh_command, 'issue_remove_label')

const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: LANE_DIRECTORY,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

function mock_lane(): void {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
	vi.spyOn(lane_output, 'record_output').mockResolvedValue({
		kind: 'recorded',
		lane: { ...LANE, output: LOG_PATH },
		output: LOG_PATH,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
	vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'session')
	vi.stubEnv('CODEX_THREAD_ID', '')
	mock_lane()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)
	vi.spyOn(git_gh_command, 'issue_apply_label').mockResolvedValue({ is_applied: true })
	vi.spyOn(detached_launch, 'launch').mockReturnValue({ kind: 'failed', note: 'spawn ENOENT' })
	read_labels.mockResolvedValue(JSON.stringify({ labels: [{ name: CREATED_CASING }] }))
	remove_label.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('lane_dispatch.dispatch_child — the marker a failed launch takes back', () => {
	it('removes a marker stored under another casing, by the spelling GitHub stored', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(remove_label).toHaveBeenCalledWith(ISSUE, CREATED_CASING)
	})

	it('warns about a removal that failed, and still reports the failed launch', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		remove_label.mockRejectedValue(new Error('gh: Forbidden (HTTP 403)'))

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('failed')
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('labels/in-progress'))
	})
})
