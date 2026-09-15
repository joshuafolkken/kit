import path from 'node:path'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { describe, expect, it } from 'vitest'
import { hook_command_rewrite } from './hook-command-rewrite'
import { transform_copied_content } from './init-copy-content'

const { apply_hook_command_rewrite_for_destination, rewrite_hook_commands } = hook_command_rewrite
const SETTINGS_DESTINATION = path.join('.claude', 'settings.json')
const SESSION_LANG_COMMAND = '{"command": "pnpm josh session:lang"}'
// A kit-side fallback-form command: prefers the built bundle, drops to `pnpm josh` when it is absent.
const KIT_FALLBACK_FORM =
	'{"command": "if [ -f dist/hooks/pretool-guard.js ]; then node dist/hooks/pretool-guard.js; else pnpm josh pretool:guard; fi"}'

function consumer_hook_commands(): ReadonlyArray<string> {
	const transformed = transform_copied_content(
		SETTINGS_DESTINATION,
		claude_settings_fixture.read_settings_text(),
	)
	const { hooks } = JSON.parse(transformed) as ReturnType<
		typeof claude_settings_fixture.load_settings
	>
	const events = [hooks.SessionStart, hooks.UserPromptSubmit, hooks.PreToolUse, hooks.PostToolUse]

	return events
		.flatMap((matchers) => matchers ?? [])
		.flatMap((entry) => entry.hooks.map((handler) => handler.command))
}

describe('rewrite_hook_commands', () => {
	it('replaces a pnpm josh hook command with the node bundle invocation', () => {
		const rewritten = rewrite_hook_commands('{"command": "pnpm josh pretool:guard"}')

		expect(rewritten).toBe(
			'{"command": "node ./node_modules/@joshuafolkken/kit/dist/josh.js pretool:guard"}',
		)
	})

	it('leaves an echo reminder untouched', () => {
		const echo = '{"command": "echo \'remember the work summary\'"}'

		expect(rewrite_hook_commands(echo)).toBe(echo)
	})

	it('does not rewrite the string where it appears outside a command field', () => {
		const prose = '{"description": "run pnpm josh gate before committing"}'

		expect(rewrite_hook_commands(prose)).toBe(prose)
	})

	// A fallback-form command carries two paths: the bundle it prefers and the `pnpm josh` fallback.
	// Both are rebased onto the installed package, so a consumer's fallback is the dispatcher bundle
	// rather than a pnpm launch (joshuafolkken/kit#2023).
	it('rebases both the bundle path and the pnpm fallback of a fallback-form command', () => {
		expect(rewrite_hook_commands(KIT_FALLBACK_FORM)).toBe(
			'{"command": "if [ -f ./node_modules/@joshuafolkken/kit/dist/hooks/pretool-guard.js ]; then node ./node_modules/@joshuafolkken/kit/dist/hooks/pretool-guard.js; else node ./node_modules/@joshuafolkken/kit/dist/josh.js pretool:guard; fi"}',
		)
	})

	// The rebased bundle path still contains `dist/hooks/`, so a blind rerun would rewrite it onto
	// itself. A second pass over already-rewritten output must be a no-op (joshuafolkken/kit#2023).
	it('is idempotent — a second rewrite leaves an already-rebased command unchanged', () => {
		const once = rewrite_hook_commands(KIT_FALLBACK_FORM)

		expect(rewrite_hook_commands(once)).toBe(once)
	})
})

describe('apply_hook_command_rewrite_for_destination', () => {
	it('rewrites only the consumer .claude/settings.json destination', () => {
		expect(
			apply_hook_command_rewrite_for_destination(SETTINGS_DESTINATION, SESSION_LANG_COMMAND),
		).toContain('node ./node_modules/@joshuafolkken/kit/dist/josh.js session:lang')
	})

	it('leaves any other destination unchanged', () => {
		expect(apply_hook_command_rewrite_for_destination('CLAUDE.md', SESSION_LANG_COMMAND)).toBe(
			SESSION_LANG_COMMAND,
		)
	})
})

// The acceptance criterion (joshuafolkken/kit#1930): the settings file a consumer receives runs no
// hook command through pnpm. Asserted against the real distributed file put through the whole copy
// transform, so a hook added later that forgets the bundle is caught here.
describe('the distributed settings.json a consumer receives', () => {
	it('runs no hook command through pnpm', () => {
		for (const command of consumer_hook_commands()) expect(command).not.toContain('pnpm')
	})

	it('invokes every josh subcommand through the node bundle', () => {
		const josh_hooks = consumer_hook_commands().filter((command) => command.includes('josh.js'))

		expect(josh_hooks.length).toBeGreaterThan(0)

		for (const command of josh_hooks) {
			expect(command).toContain('node ./node_modules/@joshuafolkken/kit/dist/josh.js ')
		}
	})

	// The per-hook bundles are launched from the installed package, so a consumer's guarded call pays
	// neither a pnpm launch nor the dispatcher's tsx re-spawn (joshuafolkken/kit#2023).
	it('launches each per-hook bundle from the installed package', () => {
		const bundle_hooks = consumer_hook_commands().filter((command) =>
			command.includes('dist/hooks/'),
		)

		expect(bundle_hooks.length).toBeGreaterThan(0)

		for (const command of bundle_hooks) {
			expect(command).toContain('node ./node_modules/@joshuafolkken/kit/dist/hooks/')
		}
	})
})
