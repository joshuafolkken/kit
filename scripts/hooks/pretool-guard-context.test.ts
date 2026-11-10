import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { issue_watch_hook } from '#scripts/issue/issue-watch-hook'
import { lane_child_mark_keys } from '#scripts/lane/lane-child-mark-keys'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { rule_rewrite } from '#scripts/rules/rule-rewrite'
import { run_parent_cut_hook } from '#scripts/run/run-parent-cut-hook'
import { run_poll_hook } from '#scripts/run/run-poll-hook'
import { run_watcher_hook } from '#scripts/run/run-watcher-hook'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_demoted } from './hook-demoted'
import { hook_ledger } from './hook-ledger'
import { pretool_outcome, pretool_outcome_async } from './pretool-guard'
import { step_zero_notice } from './step-zero-notice'

const REFUSED = 'Implementation refused before execution'
const RUNTIME_FILE = path.join('scripts', 'example.ts')
const WORKER = { [agent_session_role.KEY]: 'worker' }
const TRANSCRIPT = 'session.jsonl'

const create_directory = temporary_directory()

// An Edit of a runtime file under a fresh root, its transcript beside it so no stamp carries over.
function runtime_edit(): { root: string; raw_payload: string } {
	const root = create_directory('pretool-context-')
	const raw_payload = JSON.stringify({
		tool_name: 'Edit',
		tool_input: { file_path: path.join(root, RUNTIME_FILE), old_string: 'a', new_string: 'b' },
		transcript_path: path.join(root, TRANSCRIPT),
	})

	return { root, raw_payload }
}

const context_of = hook_context_fixture.of

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

const LANE_ISSUE = '6973'
const LANE_ENV = { [lane_child_mark_keys.KEY]: LANE_ISSUE }
const LANE_CWD = path.join('/lanes', LANE_ISSUE)

// A payload under a fresh root, its transcript beside it so no stamp carries over.
function payload_of(tool_name: string, tool_input: Record<string, unknown>): string {
	const transcript_path = path.join(create_directory('pretool-context-row-'), TRANSCRIPT)

	writeFileSync(transcript_path, '')

	return JSON.stringify({ tool_name, tool_input, transcript_path })
}

// The lane child is read off the context alone: the mark in its env, the process left unmarked.
function mark_lanes_by_context(): void {
	vi.stubEnv(lane_child_mark_keys.KEY, undefined)
	vi.spyOn(lane_child_marker, 'is_child_of').mockImplementation(
		(_directory, source) => lane_child_marker.marked_issue(source) === LANE_ISSUE,
	)
}

function ask(): string {
	return payload_of('AskUserQuestion', { questions: [] })
}

const ESLINT = { command: 'pnpm exec eslint .' }

describe('pretool_outcome — the per-call context', () => {
	it('refuses an edit for the role in the context, not the process role', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		const { root, raw_payload } = runtime_edit()

		expect(pretool_outcome(raw_payload, context_of(root, {})).reason).toContain(REFUSED)
	})

	it('allows an edit for a worker role in the context under a non-worker process', () => {
		vi.stubEnv(agent_session_role.KEY, undefined)
		const { root, raw_payload } = runtime_edit()
		const outcome = pretool_outcome(raw_payload, context_of(root, WORKER))

		expect(outcome.reason ?? '').not.toContain(REFUSED)
	})

	it('reminds Step 0 for an edit under the context cwd', () => {
		const { root, raw_payload } = runtime_edit()

		expect(pretool_outcome(raw_payload, context_of(root, WORKER)).notice).toBe(
			step_zero_notice.NOTICE,
		)
	})

	it('stays quiet on an edit outside the context cwd', () => {
		const { root, raw_payload } = runtime_edit()
		const elsewhere = path.join(root, 'elsewhere')

		expect(pretool_outcome(raw_payload, context_of(elsewhere, WORKER)).notice).toBeUndefined()
	})
})

describe('the rows and recorders read the per-call context, not the process', () => {
	it('delivers a lane row for a lane-marked context under an unmarked process', () => {
		mark_lanes_by_context()

		expect(delivered_rules.delivery(ask(), Date.now(), context_of(LANE_CWD, LANE_ENV))).toBe(
			delivered_rules.LANE_INTERACTIVE_ASK_REASON,
		)
	})

	it('stays quiet for an unmarked context under a lane-marked process', () => {
		mark_lanes_by_context()
		vi.stubEnv(lane_child_mark_keys.KEY, LANE_ISSUE)

		expect(delivered_rules.delivery(ask(), Date.now(), context_of(LANE_CWD, {}))).toBeUndefined()
	})

	it('rewrites a lane command for a lane-marked context alone', () => {
		mark_lanes_by_context()
		const raw_payload = payload_of('Bash', ESLINT)

		expect(rule_rewrite.rewrite(raw_payload, context_of(LANE_CWD, LANE_ENV))?.input).not.toEqual(
			ESLINT,
		)
		expect(rule_rewrite.rewrite(raw_payload, context_of(LANE_CWD, {}))).toBeUndefined()
	})

	it('reads the ledger directory off the context env and cwd', () => {
		const repository = process.cwd()

		expect(hook_ledger.ledger_directory(context_of(repository, {}))).toBeDefined()
		expect(hook_ledger.ledger_directory(context_of(repository, { VITEST: 'true' }))).toBeUndefined()
	})

	it('reads the demoted rules switch off the given env', () => {
		vi.stubEnv('VITEST', undefined)

		expect(hook_demoted.rules({ VITEST: 'true' }).size).toBe(0)
	})
})

describe('pretool_outcome and pretool_outcome_async — the context reaches every guard', () => {
	it('refuses through the hook for a lane-marked context under an unmarked process', () => {
		mark_lanes_by_context()

		expect(pretool_outcome(ask(), context_of(LANE_CWD, LANE_ENV)).reason).toBe(
			delivered_rules.LANE_INTERACTIVE_ASK_REASON,
		)
	})

	it('hands the call context to each asynchronous guard', async () => {
		const context = context_of(LANE_CWD, LANE_ENV)
		const watcher = vi.spyOn(run_watcher_hook, 'watcher_hook_reason').mockResolvedValue(undefined)
		const state = vi.spyOn(run_parent_cut_hook, 'current_state')
		const poll = vi.spyOn(run_poll_hook, 'safe_poll_reason').mockResolvedValue(undefined)

		vi.spyOn(run_parent_cut_hook, 'parent_cut_reason').mockResolvedValue(undefined)
		vi.spyOn(issue_watch_hook, 'watch_reason').mockResolvedValue(undefined)
		await pretool_outcome_async(payload_of('Bash', { command: 'ls' }), context)

		expect([watcher, state, poll].map((guard) => guard.mock.calls[0]?.includes(context))).toEqual([
			true,
			true,
			true,
		])
	})

	it('keeps the watcher quiet for a lane-marked context', async () => {
		vi.stubEnv(lane_child_mark_keys.KEY, undefined)
		const reason = run_watcher_hook.watcher_hook_reason(ask(), context_of(LANE_CWD, LANE_ENV))

		await expect(reason).resolves.toBeUndefined()
	})
})
