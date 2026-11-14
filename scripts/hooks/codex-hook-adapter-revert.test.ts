import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ORIGINAL = 'export const value = 1\n'
const WRITTEN = 'export const value = 2\n'
const APP = 'src/app.ts'
const CREATED = 'src/new.ts'
const TRANSCRIPT = 'transcript.jsonl'
const TSX_BIN = path.join(import.meta.dirname, '../../node_modules/.bin/tsx')
const ADAPTER_ENTRY = path.join(import.meta.dirname, 'codex-hook-adapter.ts')

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

function exec_payload(hook_event_name: string): string {
	return JSON.stringify({
		session_id: 'codex-session',
		transcript_path: in_workspace(TRANSCRIPT),
		cwd: root(),
		hook_event_name,
		tool_name: 'exec_command',
		tool_use_id: 'call-1',
		tool_input: { cmd: `node write.mjs ${APP} ${CREATED}` },
	})
}

// The adapter as Codex launches it: one process per hook, in a consultation session.
function run_adapter(mode: string, hook_event_name: string): string {
	const hook = spawnSync(TSX_BIN, [ADAPTER_ENTRY, mode], {
		cwd: root(),
		env: { ...process.env, [agent_session_role.KEY]: '' },
		input: exec_payload(hook_event_name),
		encoding: 'utf8',
	})

	return hook.stdout
}

function stamp_target(): string {
	return stamp_file.stamp_path('josh-bash-revert-', in_workspace(TRANSCRIPT))
}

beforeEach(async () => {
	fixtures.push(git_fixture_workspace.open_workspace('codex-hook-adapter-revert-'))
	write('.gitignore', `.josh/tmp/\n${TRANSCRIPT}\n`)
	write(APP, ORIGINAL)
	await git_fixture_workspace.git(root(), ['init', git_fixture_workspace.MAIN_BRANCH])
	await git_fixture_workspace.git(root(), ['add', '.'])
	await git_fixture_workspace.git(root(), ['commit', '-q', '-m', 'init'])
})

afterEach(async () => {
	rmSync(stamp_target(), { force: true })
	await Promise.all(
		fixtures.splice(0).map(async (fixture) => git_fixture_workspace.close_workspace(fixture)),
	)
})

describe('codex_hook_adapter reverting a consultation exec_command', () => {
	it('stamps before the shell and names and reverts what it wrote', () => {
		run_adapter('pretool', 'PreToolUse')
		write(APP, WRITTEN)
		write(CREATED, WRITTEN)

		const output = run_adapter('posttool', 'PostToolUse')

		expect(JSON.parse(output)).toMatchObject({ decision: 'block' })
		expect(output).toContain(`Reverted: ${APP}, ${CREATED}.`)
		expect(readFileSync(in_workspace(APP), 'utf8')).toBe(ORIGINAL)
		expect(existsSync(in_workspace(CREATED))).toBe(false)
	})

	it('writes the same empty envelope as before when the shell wrote nothing', () => {
		run_adapter('pretool', 'PreToolUse')

		expect(run_adapter('posttool', 'PostToolUse')).toBe('')
	})
})
