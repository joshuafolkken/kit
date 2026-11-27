import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bash_revert } from './bash-revert'

const ORIGINAL = 'export const value = 1\n'
const WRITTEN = 'export const value = 2\n'
const APP = 'src/app.ts'
const TRANSCRIPT = '.josh/tmp/session.jsonl'
const LAUNCH = '.josh/tmp/session/subagents/agent-a1.meta.json'
const TOOL_USE_ID = 'toolu_producer'
const TIMESTAMP = '2026-11-27T00:00:00.000Z'
const NO_FILING = '起票せずにボタンを作って'
const FILING_UNSAID = 'ボタンを作って'
const PRODUCER = { agent_id: 'a1', agent_type: 'producer' }
const COMMAND = `pnpm josh lint:related ${APP}`

const fixtures: Array<FixtureWorkspace> = []

function root(): string {
	return fixtures.at(-1)?.workspace ?? ''
}

function in_workspace(relative: string): string {
	return path.join(root(), relative)
}

function write(relative: string, content: string): void {
	mkdirSync(path.dirname(in_workspace(relative)), { recursive: true })
	writeFileSync(in_workspace(relative), content)
}

function read(relative: string): string {
	return readFileSync(in_workspace(relative), 'utf8')
}

// The parent's transcript: the person's prompt, then the Agent call that dispatched the producer.
function dispatch(prompt: string): void {
	const person = { type: 'user', timestamp: TIMESTAMP, message: { role: 'user', content: prompt } }
	const agent_call = { type: 'tool_use', id: TOOL_USE_ID, name: 'Agent', input: {} }
	const launch = { type: 'assistant', timestamp: TIMESTAMP, message: { content: [agent_call] } }

	write(TRANSCRIPT, `${JSON.stringify(person)}\n${JSON.stringify(launch)}\n`)
	write(LAUNCH, JSON.stringify({ toolUseId: TOOL_USE_ID }))
}

function producer_payload(cwd: string): string {
	return JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command: COMMAND },
		transcript_path: in_workspace(TRANSCRIPT),
		cwd,
		...PRODUCER,
	})
}

const WORKTREE = '.claude/worktrees/producer-w1'

function worktree(): string {
	return in_workspace(WORKTREE)
}

// Stamps the call, lets it write the file it names, and answers with the revert's envelope; the
// hook runs where the shell does, as `run-hook.sh` places it.
function shell_writing_app(cwd: string): string | undefined {
	bash_revert.stamp(producer_payload(cwd), cwd)
	writeFileSync(path.join(cwd, APP), WRITTEN)

	return bash_revert.revert(producer_payload(cwd), cwd)
}

async function commit_tree(directory: string): Promise<void> {
	await git_fixture_workspace.git(directory, ['init', git_fixture_workspace.MAIN_BRANCH])
	await git_fixture_workspace.git(directory, ['add', '.'])
	await git_fixture_workspace.git(directory, ['commit', '-q', '-m', 'init'])
}

beforeEach(async () => {
	fixtures.push(git_fixture_workspace.open_workspace('bash-revert-producer-'))
	write('.gitignore', '.josh/tmp/\n.claude/\n')
	write(APP, ORIGINAL)
	write(path.join(WORKTREE, APP), ORIGINAL)
	await commit_tree(worktree())
	await commit_tree(root())
	vi.stubEnv(agent_session_role.KEY, undefined)
})

afterEach(async () => {
	vi.unstubAllEnvs()
	rmSync(stamp_file.stamp_path('josh-bash-revert-', in_workspace(TRANSCRIPT)), { force: true })

	await Promise.all(
		fixtures.splice(0).map(async (fixture) => git_fixture_workspace.close_workspace(fixture)),
	)
})

describe('bash_revert with a granted producer in its own worktree', () => {
	it('leaves the file its command names as the producer wrote it', () => {
		dispatch(NO_FILING)

		expect(shell_writing_app(worktree())).toBeUndefined()
		expect(read(path.join(WORKTREE, APP))).toBe(WRITTEN)
	})
})

describe('bash_revert with a producer outside its grant', () => {
	it('reverts a granted producer shell running in the checkout', () => {
		dispatch(NO_FILING)

		expect(shell_writing_app(root())).toContain(APP)
		expect(read(APP)).toBe(ORIGINAL)
	})

	it('reverts a worktree shell of a producer the prompt did not grant', () => {
		dispatch(FILING_UNSAID)

		expect(shell_writing_app(worktree())).toContain(APP)
		expect(read(path.join(WORKTREE, APP))).toBe(ORIGINAL)
	})
})
