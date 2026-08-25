import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { eval_sandbox } from './eval-sandbox'
import { scenario_with } from './eval-scenario-fixture'

// Exercised against the real filesystem rather than mocked: what this module promises is that the
// agent under test reads the documents kit actually distributes, and a mocked `cpSync` would assert
// that a call was made rather than that the files arrived.
const sandboxes: Array<string> = []

function sandbox_for(body: Record<string, unknown> = {}): string {
	const sandbox_path = eval_sandbox.create_sandbox(scenario_with(body))

	sandboxes.push(sandbox_path)

	return sandbox_path
}

afterEach(() => {
	for (const sandbox_path of sandboxes) eval_sandbox.remove_sandbox(sandbox_path)
	sandboxes.length = 0
})

describe('eval_sandbox.create_sandbox', () => {
	it.each([...eval_sandbox.DISTRIBUTED_PATHS])('carries %s', (relative) => {
		const sandbox_path = sandbox_for()

		expect(existsSync(path.join(sandbox_path, relative))).toBe(true)
	})

	// The skills are the half kit#854 moved the procedures into, so a sandbox that copied only the
	// three documents would measure an agent with the trigger and none of the procedure.
	it('carries the workflow skill the documents route to', () => {
		const entry = path.join(sandbox_for(), '.claude/skills/workflow-commands/SKILL.md')

		expect(readFileSync(entry, 'utf8')).toContain('name: workflow-commands')
	})

	it('writes the fixture files a scenario declares', () => {
		const sandbox_path = sandbox_for({
			/* eslint-disable-next-line @typescript-eslint/naming-convention -- a fixture key is a file path */
			fixture_files: { 'src/deep/probe.ts': 'export {}\n' },
		})

		expect(readFileSync(path.join(sandbox_path, 'src/deep/probe.ts'), 'utf8')).toBe('export {}\n')
	})

	it('gives each scenario its own directory, so one run cannot see another', () => {
		expect(sandbox_for()).not.toBe(sandbox_for())
	})

	// `--allowed-tools` does not deny anything under `-p` — a probe confirmed the agent edited a file
	// it was not allowed to — so the throwaway directory is the only thing keeping a scenario's
	// mutating calls off a real repository.
	it('is outside the repository it copied from', () => {
		expect(sandbox_for().startsWith(process.cwd())).toBe(false)
	})
})

describe('eval_sandbox.remove_sandbox', () => {
	it('removes the tree, so a suite run does not leak a copy per scenario', () => {
		const sandbox_path = sandbox_for()

		eval_sandbox.remove_sandbox(sandbox_path)

		expect(existsSync(sandbox_path)).toBe(false)
	})

	it('is silent on a path that is already gone', () => {
		const sandbox_path = sandbox_for()

		eval_sandbox.remove_sandbox(sandbox_path)

		expect(() => {
			eval_sandbox.remove_sandbox(sandbox_path)
		}).not.toThrow()
	})
})

// The distributed settings carry two kinds of hook. The `UserPromptSubmit` ones are plain `echo`s
// stating behavioral rules — the sort of thing this suite exists to measure. The `PostToolUse` one
// runs the project formatter through pnpm, which in a directory with no package.json dies with
// ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND and feeds that error back to the agent after every Edit and
// Write. Copying it verbatim would not measure the hook; it would corrupt every scenario that writes.
// The event name is Claude Code's, so it is reached by key rather than written as a property name.
const HOOK_EVENT = 'PostToolUse'

interface HookGroup {
	hooks: Array<unknown>
}

function settings_with(command: string): string {
	return JSON.stringify({
		hooks: { [HOOK_EVENT]: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }] },
	})
}

function hooks_left(raw: string): number {
	const parsed = JSON.parse(raw) as { hooks: Record<string, Array<HookGroup>> }

	return parsed.hooks[HOOK_EVENT]?.[0]?.hooks.length ?? 0
}

describe('eval_sandbox.sandbox_settings', () => {
	it.each(['pnpm josh format:edited', 'npm run fix', 'npx prettier --write .', 'josh lint'])(
		'drops a hook running %j',
		(command) => {
			const filtered = eval_sandbox.sandbox_settings(settings_with(command))

			expect(hooks_left(filtered)).toBe(0)
		},
	)

	it('keeps a hook that runs anywhere', () => {
		const kept = eval_sandbox.sandbox_settings(settings_with("echo 'a rule'"))

		expect(hooks_left(kept)).toBe(1)
	})

	it('passes settings with no hooks through untouched', () => {
		const raw = JSON.stringify({ permissions: { deny: [] } })

		expect(eval_sandbox.sandbox_settings(raw)).toBe(raw)
	})

	// The rule-stating hooks are what a scenario reads, so the real file has to still carry them here.
	it('keeps the shipped rule hooks', () => {
		const sandbox_path = sandbox_for()
		const written = readFileSync(path.join(sandbox_path, eval_sandbox.SETTINGS_PATH), 'utf8')

		expect(written).toContain('MANDATORY')
		expect(written).not.toContain('josh format:edited')
	})
})
