import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bash_revert } from './bash-revert'
import { pretool_guard } from './pretool-guard'

const ORIGINAL = 'export const value = 1\n'
const WRITTEN = 'export const value = 2\n'
const SHELL_WRITTEN = 'export const value = 3\n'
const APP = 'src/app.ts'
const CREATED = 'src/new.ts'
const SCRATCH = '.josh/tmp/plan.json'
const BEFORE_CALL = '.josh/tmp/bash-revert/before-call'
const OBSERVATION = '.josh/observations/2026-11-07.json'
const DOC = 'docs/guide.md'
const TRANSCRIPT = 'transcript.jsonl'
const HANDOFF = 'hand implementation to a worker lane'
const SETTINGS = path.join(import.meta.dirname, '../../.claude/settings.json')
const TSX_BIN = path.join(import.meta.dirname, '../../node_modules/.bin/tsx')
const POSTTOOL_ENTRY = path.join(import.meta.dirname, 'format-edited-cli.ts')

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

// The shell names the files it writes, which is what makes a change this shell's.
function shell_payload(command = `node write.mjs ${APP} ${CREATED}`): string {
	return JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command },
		transcript_path: in_workspace(TRANSCRIPT),
	})
}

function stamp_target(): string {
	return stamp_file.stamp_path('josh-bash-revert-', in_workspace(TRANSCRIPT))
}

function stamp(): void {
	bash_revert.stamp(shell_payload(), root())
}

function revert(command?: string): string | undefined {
	return bash_revert.revert(shell_payload(command), root())
}

beforeEach(async () => {
	fixtures.push(git_fixture_workspace.open_workspace('bash-revert-'))
	write('.gitignore', `.josh/tmp/\n${TRANSCRIPT}\n`)
	write(APP, ORIGINAL)
	await git_fixture_workspace.git(root(), ['init', git_fixture_workspace.MAIN_BRANCH])
	await git_fixture_workspace.git(root(), ['add', '.'])
	await git_fixture_workspace.git(root(), ['commit', '-q', '-m', 'init'])
	vi.stubEnv(agent_session_role.KEY, undefined)
})

afterEach(async () => {
	vi.unstubAllEnvs()
	rmSync(stamp_target(), { force: true })

	await Promise.all(
		fixtures.splice(0).map(async (fixture) => git_fixture_workspace.close_workspace(fixture)),
	)
})

describe('bash_revert reverting a consultation shell', () => {
	it('reverts a runtime file the shell wrote or created and names both', () => {
		stamp()
		write(APP, WRITTEN)
		write(CREATED, WRITTEN)

		const envelope = revert() ?? ''

		expect(JSON.parse(envelope)).toMatchObject({ decision: 'block' })
		expect(envelope).toContain(APP)
		expect(envelope).toContain(CREATED)
		expect(envelope).toContain(HANDOFF)
		expect(read(APP)).toBe(ORIGINAL)
		expect(existsSync(in_workspace(CREATED))).toBe(false)
	})

	it('keeps a copy of each reverted file under the backup the block names', () => {
		stamp()
		write(CREATED, WRITTEN)

		const reason = String(JSON.parse(revert() ?? '{}').reason)
		const backup = /(\.josh\/tmp\/bash-revert\/\S+)\/\./u.exec(reason)?.[1] ?? ''

		expect(read(path.join(backup, CREATED))).toBe(WRITTEN)
	})

	it('restores a runtime file the shell deleted', () => {
		stamp()
		rmSync(in_workspace(APP))

		expect(revert()).toContain(APP)
		expect(read(APP)).toBe(ORIGINAL)
	})
})

describe('bash_revert restoring a runtime file dirty before the call', () => {
	it('puts the shell write back to the content before the call, not HEAD', () => {
		write(APP, WRITTEN)
		stamp()
		write(APP, SHELL_WRITTEN)

		const reason = String(JSON.parse(revert() ?? '{}').reason)
		const backup = /(\.josh\/tmp\/bash-revert\/\S+)\/\./u.exec(reason)?.[1] ?? ''

		expect(reason).toContain(`Restored to their content before the call: ${APP}.`)
		expect(reason).not.toContain('Reverted:')
		expect(read(APP)).toBe(WRITTEN)
		expect(read(path.join(backup, APP))).toBe(SHELL_WRITTEN)
	})

	it('restores the edit a shell discarded by resetting the file to HEAD', () => {
		write(APP, WRITTEN)
		stamp()
		write(APP, ORIGINAL)

		expect(revert()).toContain(`Restored to their content before the call: ${APP}.`)
		expect(read(APP)).toBe(WRITTEN)
	})

	it('removes again a file absent before the call that the shell recreated', () => {
		rmSync(in_workspace(APP))
		stamp()
		write(APP, SHELL_WRITTEN)

		expect(revert()).toContain(`Restored to their content before the call: ${APP}.`)
		expect(existsSync(in_workspace(APP))).toBe(false)
	})
})

describe('bash_revert without the content a dirty file had before the call', () => {
	it('names a dirty runtime file whose saved content no longer matches its stamp', () => {
		write(APP, WRITTEN)
		stamp()
		rmSync(in_workspace(BEFORE_CALL), { recursive: true, force: true })
		write(APP, SHELL_WRITTEN)

		expect(revert()).toContain(`kept as dirty before the call: ${APP}`)
		expect(read(APP)).toBe(SHELL_WRITTEN)
	})

	it('judges the call by its own stamp when saving the dirty content fails', () => {
		stamp()
		write(APP, WRITTEN)
		write(BEFORE_CALL, '')
		stamp()

		expect(revert()).toBeUndefined()
		expect(read(APP)).toBe(WRITTEN)
	})
})

describe('bash_revert leaving a consultation shell alone', () => {
	it('keeps a runtime file that was already dirty and the shell left alone', () => {
		write(APP, WRITTEN)
		stamp()

		expect(revert()).toBeUndefined()
		expect(read(APP)).toBe(WRITTEN)
	})

	it('keeps a dirty runtime file the shell left alone while restoring one it wrote', () => {
		write(APP, WRITTEN)
		write(CREATED, ORIGINAL)
		stamp()
		write(CREATED, WRITTEN)

		expect(revert()).toContain(`Restored to their content before the call: ${CREATED}.`)
		expect(read(APP)).toBe(WRITTEN)
		expect(read(CREATED)).toBe(ORIGINAL)
	})

	it('leaves writes under .josh/ and to docs in place', () => {
		stamp()
		write(SCRATCH, '{}')
		write(OBSERVATION, '{}')
		write(DOC, '# guide\n')

		expect(revert()).toBeUndefined()
		expect([SCRATCH, OBSERVATION, DOC].every((file) => existsSync(in_workspace(file)))).toBe(true)
	})

	it('reverts nothing without a stamp from before the call', () => {
		write(APP, WRITTEN)

		expect(revert()).toBeUndefined()
		expect(read(APP)).toBe(WRITTEN)
	})
})

describe('bash_revert with a change its command does not name', () => {
	const READ_ONLY = 'pnpm josh tree:status'

	it('keeps another process write to a file clean before the call and names it', () => {
		stamp()
		write(APP, WRITTEN)
		write(CREATED, WRITTEN)

		const reason = String(JSON.parse(revert(READ_ONLY) ?? '{}').reason)

		expect(reason).toContain(`left in place: ${APP}, ${CREATED}.`)
		expect(reason).not.toContain(HANDOFF)
		expect(read(APP)).toBe(WRITTEN)
		expect(read(CREATED)).toBe(WRITTEN)
	})

	it('keeps another process write to a file dirty before the call', () => {
		write(APP, WRITTEN)
		stamp()
		write(APP, SHELL_WRITTEN)

		expect(revert(READ_ONLY)).toContain(`left in place: ${APP}.`)
		expect(read(APP)).toBe(SHELL_WRITTEN)
	})

	it('reverts the file the command names and keeps the one it does not', () => {
		stamp()
		write(APP, WRITTEN)
		write(CREATED, WRITTEN)

		const reason = String(JSON.parse(revert(`node write.mjs ${CREATED}`) ?? '{}').reason)

		expect(reason).toContain(`Reverted: ${CREATED}.`)
		expect(reason).toContain(`left in place: ${APP}.`)
		expect(read(APP)).toBe(WRITTEN)
		expect(existsSync(in_workspace(CREATED))).toBe(false)
	})
})

describe('bash_revert reading the paths its command names', () => {
	it('does not take a path the command names only as a prefix of a longer one', () => {
		stamp()
		write(APP, WRITTEN)

		expect(revert(`node write.mjs ${APP}x`)).toContain(`left in place: ${APP}.`)
		expect(read(APP)).toBe(WRITTEN)
	})

	it('does not take a path a reading command names', () => {
		write(APP, WRITTEN)
		stamp()
		write(APP, SHELL_WRITTEN)

		expect(revert(`cat ${APP}`)).toContain(`left in place: ${APP}.`)
		expect(read(APP)).toBe(SHELL_WRITTEN)
	})

	it('takes a path the command names under an absolute root', () => {
		stamp()
		write(APP, WRITTEN)

		expect(revert(`node write.mjs '${in_workspace(APP)}'`)).toContain(`Reverted: ${APP}.`)
		expect(read(APP)).toBe(ORIGINAL)
	})
})

describe('bash_revert in an implementation session', () => {
	it('neither stamps nor reverts', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		stamp()
		write(APP, WRITTEN)

		expect(revert()).toBeUndefined()
		expect(read(APP)).toBe(WRITTEN)
	})
})

describe('bash_revert wiring', () => {
	it('launches the PostToolUse hook on Bash through run-hook.sh', () => {
		expect(readFileSync(SETTINGS, 'utf8')).toMatch(
			/"matcher": "Edit\|Write\|Bash"[^\]]*run-hook\.sh\\" format-edited/u,
		)
	})

	it('stamps a consultation shell from the PreToolUse guard', async () => {
		const write_out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		await pretool_guard.respond(shell_payload())
		write_out.mockRestore()

		expect(existsSync(stamp_target())).toBe(true)
	})

	it('reverts through the PostToolUse entry a Bash payload reaches', () => {
		const consultation = { ...process.env, [agent_session_role.KEY]: '' }

		stamp()
		write(CREATED, WRITTEN)

		const hook = spawnSync(TSX_BIN, [POSTTOOL_ENTRY], {
			cwd: root(),
			env: consultation,
			input: shell_payload(),
			encoding: 'utf8',
		})

		expect(hook.stdout).toContain(`Reverted: ${CREATED}.`)
		expect(existsSync(in_workspace(CREATED))).toBe(false)
	})

	it('routes only a Bash payload to the revert', () => {
		const edit = JSON.stringify({ tool_name: 'Edit', transcript_path: in_workspace(TRANSCRIPT) })

		expect(bash_revert.is_shell(shell_payload())).toBe(true)
		expect(bash_revert.is_shell(edit)).toBe(false)
	})
})
