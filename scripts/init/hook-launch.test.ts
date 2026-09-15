import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hook_launch } from './hook-launch'

const { hook_launch_command, launch_command } = hook_launch

const PRETOOL_BUNDLE = 'pretool-guard.js'
const PRETOOL_COMMAND = 'pretool:guard'

// The three settings.json hooks: the bundle each launches and the josh subcommand it falls back to.
const HOOKS = [
	{ bundle: PRETOOL_BUNDLE, command: PRETOOL_COMMAND },
	{ bundle: 'format-edited.js', command: 'format:edited' },
	{ bundle: 'session-lang.js', command: 'session:lang' },
] as const

// The branch selection is what the fallback is for, so it is exercised as a real shell decision: a
// present primary runs, a missing one drops to the fallback.
async function run_fallback_branch(primary_path: string): Promise<string> {
	const command = launch_command(primary_path, 'echo FALLBACK')
	const { stdout } = await execa('sh', ['-c', command])

	return stdout.trim()
}

function command_containing(fragment: string): string {
	const { hooks } = claude_settings_fixture.load_settings()
	const events = [hooks.UserPromptSubmit, hooks.PreToolUse, hooks.PostToolUse]
	const commands = events
		.flatMap((matchers) => matchers ?? [])
		.flatMap((entry) => entry.hooks.map((handler) => handler.command))
	const found = commands.find((command) => command.includes(fragment))
	if (found === undefined) throw new Error(`no hook command contains ${fragment}`)

	return found
}

describe('launch_command', () => {
	it('prefers the primary path and falls back without an && / || chain', () => {
		expect(launch_command('dist/hooks/x.js', 'pnpm josh x')).toBe(
			'if [ -f dist/hooks/x.js ]; then node dist/hooks/x.js; else pnpm josh x; fi',
		)
	})
})

describe('hook_launch_command', () => {
	it('launches the bundle and falls back to the josh subcommand', () => {
		expect(hook_launch_command(PRETOOL_BUNDLE, PRETOOL_COMMAND)).toBe(
			'if [ -f dist/hooks/pretool-guard.js ]; then node dist/hooks/pretool-guard.js; else pnpm josh pretool:guard; fi',
		)
	})
})

describe('the fallback branch a hook command takes', () => {
	let directory: string
	let primary: string

	beforeAll(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'hook-launch-'))
		primary = path.join(directory, 'primary.js')
		writeFileSync(primary, "console.log('PRIMARY')\n")
	})

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	it('runs the primary bundle when it exists', async () => {
		expect(await run_fallback_branch(primary)).toBe('PRIMARY')
	})

	it('runs the fallback when the bundle is missing', async () => {
		expect(await run_fallback_branch(path.join(directory, 'absent.js'))).toBe('FALLBACK')
	})
})

// kit's own settings.json must launch each hook off the built bundle (no pnpm on the primary path),
// and it stays in sync with the generator: a hand-edit that drifts from `hook_launch_command` is
// caught here rather than shipping a command that no longer matches the built layout.
describe("kit's own settings.json", () => {
	it('launches each hook with the generated command', () => {
		for (const { bundle, command } of HOOKS) {
			expect(command_containing(bundle)).toBe(hook_launch_command(bundle, command))
		}
	})
})
