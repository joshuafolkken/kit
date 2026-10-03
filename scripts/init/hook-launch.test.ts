import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_launch } from './hook-launch'

const { BUNDLE_READY_GATE, hook_launch_command, launch_command, PROJECT_ROOT_PREFIX } = hook_launch

const PRETOOL_BUNDLE = 'pretool-guard.js'
const PRETOOL_COMMAND = 'pretool:guard'
const FALLBACK = 'echo FALLBACK'
// The bundle the bootstrap fixture's partial install writes, relative to the checkout root.
const INSTALLED_BUNDLE = 'node node_modules/@joshuafolkken/kit/dist/hooks/pretool-guard.js'

// The four settings.json hooks: the bundle each launches and the josh subcommand it falls back to.
const HOOKS = [
	{ bundle: PRETOOL_BUNDLE, command: PRETOOL_COMMAND },
	{ bundle: 'format-edited.js', command: 'format:edited' },
	{ bundle: 'session-lang.js', command: 'session:lang' },
	{ bundle: 'stop-guard.js', command: 'stop:guard' },
] as const

// The branch selection is what the fallback is for, so it is exercised as a real shell decision: a
// passing gate runs the primary, a failing one drops to the fallback.
async function run_branch(gate: string): Promise<string> {
	const { stdout } = await execa('sh', ['-c', launch_command(gate, 'echo PRIMARY', FALLBACK)])

	return stdout.trim()
}

function command_containing(fragment: string): string {
	const { hooks } = claude_settings_fixture.load_settings()
	const events = [hooks.UserPromptSubmit, hooks.PreToolUse, hooks.PostToolUse, hooks.Stop]
	const commands = events
		.flatMap((matchers) => matchers ?? [])
		.flatMap((entry) => entry.hooks.map((handler) => handler.command))
	const found = commands.find((command) => command.includes(fragment))
	if (found === undefined) throw new Error(`no hook command contains ${fragment}`)

	return found
}

describe('launch_command', () => {
	it('selects the primary on the gate and falls back without an && / || chain', () => {
		expect(launch_command('gate', 'node x.js', 'pnpm josh x')).toBe(
			'if gate; then node x.js; else pnpm josh x; fi',
		)
	})
})

describe('hook_launch_command', () => {
	it('starts from the project root, passes the ready gate, and falls back to the josh subcommand', () => {
		expect(hook_launch_command(PRETOOL_BUNDLE, PRETOOL_COMMAND)).toBe(
			`${PROJECT_ROOT_PREFIX}if ${BUNDLE_READY_GATE}; then node dist/hooks/pretool-guard.js; else pnpm josh pretool:guard; fi`,
		)
	})
})

describe('the branch a hook command takes', () => {
	it('runs the primary bundle when the gate passes', async () => {
		expect(await run_branch('true')).toBe('PRIMARY')
	})

	it('runs the fallback when the gate fails', async () => {
		expect(await run_branch('false')).toBe('FALLBACK')
	})
})

// joshuafolkken/kit#2984: every path after the prefix is relative, so a hook fired from a subdirectory
// has to find its bundle from the root rather than from where the session stands.
describe('a hook command fired from a project subdirectory', () => {
	it('resolves the bundle from the project root', () => {
		const command = `${PROJECT_ROOT_PREFIX}${launch_command('true', INSTALLED_BUNDLE, FALLBACK)}`
		const result = hook_command_bootstrap.run_in_temporary_checkout(command, true, true)

		expect(result.status).toBe(0)
		expect(result.stdout).toBe('guard ran')
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
