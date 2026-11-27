import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HookContext } from './hook-context'

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))
vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: {
		current_state: vi.fn(),
		parent_cut_reason: vi.fn().mockResolvedValue(undefined),
	},
}))
vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

const { pretool_guard } = await import('./pretool-guard')

// joshuafolkken/kit#9091: the whole PreToolUse chain, not the authority rule alone, passes a granted
// producer's `josh git:checkpoint` — round 1 found a second rule refusing what the first allowed.
const create_directory = temporary_directory('suite')
const ROOT = create_directory('guard-checkpoint-')
const WORKTREE = path.join(ROOT, '.claude', 'worktrees', 'producer-w1')
const TIMESTAMP = '2026-11-27T00:00:00.000Z'
const TOOL_USE_ID = 'toolu_producer'
const PRODUCER = { agent_id: 'a1', agent_type: 'producer' }
const CHECKPOINT = 'pnpm josh git:checkpoint theme "theme colors"'

afterEach(() => {
	vi.unstubAllEnvs()
})

// A parent transcript holding a no-filing request and the Agent call that launched `PRODUCER`.
function granted_transcript(): string {
	const directory = create_directory('guard-checkpoint-transcript-')
	const file_path = path.join(directory, 'session.jsonl')
	const subagents = path.join(directory, 'session', 'subagents')
	const prompt = { role: 'user', content: '起票せずにボタンを作って' }
	const dispatch = { content: [{ type: 'tool_use', id: TOOL_USE_ID, name: 'Agent', input: {} }] }
	const lines = [
		{ type: 'user', timestamp: TIMESTAMP, message: prompt },
		{ type: 'assistant', timestamp: TIMESTAMP, message: dispatch },
	]

	writeFileSync(file_path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
	mkdirSync(subagents, { recursive: true })
	writeFileSync(
		path.join(subagents, 'agent-a1.meta.json'),
		JSON.stringify({ toolUseId: TOOL_USE_ID }),
	)

	return file_path
}

function outcome(command: string, unit: object = PRODUCER): string | undefined {
	vi.stubEnv(agent_session_role.KEY, 'scheduler')
	mkdirSync(WORKTREE, { recursive: true })
	const payload = {
		hook_event_name: 'PreToolUse',
		tool_name: 'Bash',
		tool_input: { command },
		transcript_path: granted_transcript(),
		cwd: WORKTREE,
		...unit,
	}
	const context: HookContext = { cwd: WORKTREE, env: process.env, ancestry: () => new Set() }

	return pretool_guard.pretool_outcome(JSON.stringify(payload), context).reason
}

describe('pretool guard — a producer checkpoint', () => {
	it('passes the josh checkpoint in the producer’s worktree', () => {
		expect(outcome(CHECKPOINT)).toBeUndefined()
	})

	it.each([
		['a raw checkpoint commit', 'git add -A && git commit -m "WIP checkpoint: x"', PRODUCER],
		['the checkpoint from the main line', CHECKPOINT, {}],
	])('refuses %s', (_name, command, unit) => {
		expect(outcome(command, unit)).toEqual(expect.any(String))
	})
})
