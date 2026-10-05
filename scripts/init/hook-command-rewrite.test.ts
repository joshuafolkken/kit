import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { describe, expect, it, vi } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_command_rewrite } from './hook-command-rewrite'
import { hook_launch } from './hook-launch'
import { transform_copied_content } from './init-copy-content'

const { apply_hook_command_rewrite_for_destination, rewrite_hook_commands } = hook_command_rewrite
const SETTINGS_DESTINATION = path.join('.claude', 'settings.json')
const CODEX_HOOKS_DESTINATION = path.join('.codex', 'hooks.json')
const CODEX_HOOKS_SOURCE = fileURLToPath(new URL('../../.codex/hooks.json', import.meta.url))
const SESSION_LANG_COMMAND = '{"command": "pnpm josh session:lang"}'
// A kit-side launcher command: the hook launcher picks the built bundle or the live source itself.
const KIT_LAUNCHER_FORM = '{"command": "sh scripts/hooks/run-hook.sh pretool-guard"}'
const CONSUMER_LAUNCHER = 'sh ./node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh'
const PRETOOL_SOURCE = '{"command": "pnpm josh pretool:guard"}'
const INSTALL_NOTICE = 'run pnpm install, then reread CLAUDE.md'
const GUARD_OUTPUT = 'guard ran'
const FOREIGN_DIRECTORY_PREFIX = 'kit-hook-foreign-'
const CONSUMER_JOSH_COMMAND = 'node ./node_modules/@joshuafolkken/kit/dist/josh.js'
const ROOT_COMMAND = 'git rev-parse --show-toplevel'

function consumer_hook_commands(): ReadonlyArray<string> {
	const transformed = transform_copied_content(
		SETTINGS_DESTINATION,
		claude_settings_fixture.read_settings_text(),
	)
	const { hooks } = JSON.parse(transformed) as ReturnType<
		typeof claude_settings_fixture.load_settings
	>
	const events = [
		hooks.SessionStart,
		hooks.UserPromptSubmit,
		hooks.PreToolUse,
		hooks.PostToolUse,
		hooks.Stop,
	]

	return events
		.flatMap((matchers) => matchers ?? [])
		.flatMap((entry) => entry.hooks.map((handler) => handler.command))
}

describe('rewrite_hook_commands', () => {
	it('replaces a pnpm josh hook command with the node bundle invocation', () => {
		const rewritten = rewrite_hook_commands(PRETOOL_SOURCE)

		expect(rewritten).toContain(INSTALL_NOTICE)
		expect(rewritten).toContain(`${CONSUMER_JOSH_COMMAND} pretool:guard`)
	})

	it('leaves an echo reminder untouched', () => {
		const echo = '{"command": "echo \'remember the work summary\'"}'

		expect(rewrite_hook_commands(echo)).toBe(echo)
	})

	it('does not rewrite the string where it appears outside a command field', () => {
		const prose = '{"description": "run pnpm josh gate before committing"}'

		expect(rewrite_hook_commands(prose)).toBe(prose)
	})

	// The launcher is rebased onto the installed package, where it picks the installed bundle or the
	// dispatcher on its own (joshuafolkken/kit#3184).
	it('rebases the hook launcher onto the installed package', () => {
		const rewritten = rewrite_hook_commands(KIT_LAUNCHER_FORM)

		expect(rewritten).toContain(INSTALL_NOTICE)
		expect(rewritten).toContain(`${CONSUMER_LAUNCHER} pretool-guard`)
	})

	// The rebased launcher path still ends in the source path, so a blind rerun would rewrite it onto
	// itself. A second pass over already-rewritten output must be a no-op (joshuafolkken/kit#2023).
	it('is idempotent — a second rewrite leaves an already-rebased command unchanged', () => {
		const once = rewrite_hook_commands(KIT_LAUNCHER_FORM)

		expect(rewrite_hook_commands(once)).toBe(once)
	})
})

describe('bootstrap without installed dependencies', () => {
	it('initializes the temporary checkout when GIT_DIR points elsewhere', () => {
		const foreign_root = mkdtempSync(path.join(tmpdir(), FOREIGN_DIRECTORY_PREFIX))

		vi.stubEnv('GIT_DIR', path.join(foreign_root, '.git'))

		try {
			const result = hook_command_bootstrap.run_in_temporary_checkout(
				'test -d .git && git rev-parse --is-inside-work-tree',
			)

			expect(result.status).toBe(0)
			expect(result.stdout.trim()).toBe('true')
		} finally {
			vi.unstubAllEnvs()

			rmSync(foreign_root, { recursive: true, force: true })
		}
	})

	it.each([SETTINGS_DESTINATION, CODEX_HOOKS_DESTINATION])(
		'lets bootstrap proceed with a clear notice when %s has no installed kit',
		(destination) => {
			const rewritten = transform_copied_content(destination, PRETOOL_SOURCE)
			const { command } = JSON.parse(rewritten) as { command: string }
			const result = hook_command_bootstrap.run_in_temporary_checkout(command)

			expect(result.status).toBe(0)
			expect(result.stderr).toContain(INSTALL_NOTICE)
			expect(result.stderr).not.toContain('Cannot find module')
		},
	)

	it('runs a present hook bundle even if the dispatcher is missing', () => {
		const rewritten = rewrite_hook_commands(KIT_LAUNCHER_FORM)
		const { command } = JSON.parse(rewritten) as { command: string }
		const result = hook_command_bootstrap.run_in_temporary_checkout(command, true)

		expect(result.status).toBe(0)
		expect(result.stdout).toBe(GUARD_OUTPUT)
		expect(result.stderr).not.toContain(INSTALL_NOTICE)
	})
})

describe('installed hook from a project subdirectory', () => {
	it('runs the hook bundle instead of reporting an inactive installation', () => {
		const rewritten = rewrite_hook_commands(KIT_LAUNCHER_FORM)
		const { command } = JSON.parse(rewritten) as { command: string }
		const result = hook_command_bootstrap.run_in_temporary_checkout(command, true, true)

		expect(result.status).toBe(0)
		expect(result.stdout).toBe(GUARD_OUTPUT)
		expect(result.stderr).not.toContain(INSTALL_NOTICE)
	})

	it('runs the hook bundle when Git points to another work tree', () => {
		const foreign_root = mkdtempSync(path.join(tmpdir(), FOREIGN_DIRECTORY_PREFIX))
		const rewritten = rewrite_hook_commands(KIT_LAUNCHER_FORM)
		const { command } = JSON.parse(rewritten) as { command: string }

		try {
			const result = hook_command_bootstrap.run_in_temporary_checkout(command, true, true, {
				git_overrides: { GIT_WORK_TREE: foreign_root },
			})

			expect(result.status).toBe(0)
			expect(result.stdout).toBe(GUARD_OUTPUT)
			expect(result.stderr).not.toContain(INSTALL_NOTICE)
		} finally {
			rmSync(foreign_root, { recursive: true, force: true })
		}
	})

	it('runs the hook bundle when Git metadata is outside the work tree', () => {
		const rewritten = rewrite_hook_commands(KIT_LAUNCHER_FORM)
		const { command } = JSON.parse(rewritten) as { command: string }
		const result = hook_command_bootstrap.run_in_temporary_checkout(command, true, true, {
			is_external_git: true,
		})

		expect(result.status).toBe(0)
		expect(result.stdout).toBe(GUARD_OUTPUT)
		expect(result.stderr).not.toContain(INSTALL_NOTICE)
	})
})

describe('apply_hook_command_rewrite_for_destination', () => {
	it('rebases Codex hook commands to the installed launcher', () => {
		const source = readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
		const transformed = transform_copied_content(CODEX_HOOKS_DESTINATION, source)

		expect(JSON.parse(transformed)).toHaveProperty('hooks')

		const commands = [...transformed.matchAll(/"command":\s*"((?:[^"\\]|\\.)*)"/gu)]
			.map((match) => match[1] ?? '')
			.filter((command) => command.includes('codex-hook-adapter'))

		expect(commands).toHaveLength(2)

		for (const command of commands) {
			expect(command).toContain(ROOT_COMMAND)
			expect(command).toContain(`${CONSUMER_LAUNCHER} codex-hook-adapter`)
			expect(command).not.toContain('sh scripts/hooks/')
		}
	})

	it('keeps the Codex hook rewrite stable when applied twice', () => {
		const source = readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
		const once = transform_copied_content(CODEX_HOOKS_DESTINATION, source)

		expect(transform_copied_content(CODEX_HOOKS_DESTINATION, once)).toBe(once)
	})

	it('rewrites only the consumer .claude/settings.json destination', () => {
		expect(
			apply_hook_command_rewrite_for_destination(SETTINGS_DESTINATION, SESSION_LANG_COMMAND),
		).toContain(`${CONSUMER_JOSH_COMMAND} session:lang`)
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
		for (const command of consumer_hook_commands()) {
			expect(command).not.toMatch(/\bpnpm (?:josh|exec)\b/u)
		}
	})

	it('invokes every josh subcommand through the node bundle', () => {
		const josh_hooks = consumer_hook_commands().filter((command) => command.includes('josh.js'))

		expect(josh_hooks.length).toBeGreaterThan(0)

		for (const command of josh_hooks) {
			expect(command).toContain(`${CONSUMER_JOSH_COMMAND} `)
		}
	})

	it('starts every installed hook command from the project root', () => {
		for (const command of consumer_hook_commands()) {
			if (!command.includes('node_modules/@joshuafolkken/kit')) continue
			expect(command).toContain(ROOT_COMMAND)
		}
	})

	// The per-hook bundles are launched from the installed package, so a consumer's guarded call pays
	// neither a pnpm launch nor the dispatcher's tsx re-spawn (joshuafolkken/kit#2023).
	it('launches each per-hook bundle through the installed launcher', () => {
		const bundle_hooks = consumer_hook_commands().filter((command) =>
			command.includes(hook_launch.RUN_HOOK_SCRIPT),
		)

		expect(bundle_hooks.length).toBeGreaterThan(0)

		for (const command of bundle_hooks) {
			expect(command).toContain(`${CONSUMER_LAUNCHER} `)
		}
	})
})

// kit's own hook commands already start from the root and pass the bundle-ready gate
// (joshuafolkken/kit#2984); the copy a consumer receives must carry the root prefix once and swap the
// gate — whose script ships only in kit's checkout — for a presence check.
describe("kit's own launch command as a consumer receives it", () => {
	it('carries the project-root prefix at most once', () => {
		for (const command of consumer_hook_commands()) {
			expect(command.split(hook_launch.PROJECT_ROOT_PREFIX).length).toBeLessThanOrEqual(2)
		}
	})

	it.each([SETTINGS_DESTINATION, CODEX_HOOKS_DESTINATION])(
		'launches no hook from the source tree in %s',
		(destination) => {
			const source =
				destination === CODEX_HOOKS_DESTINATION
					? readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
					: claude_settings_fixture.read_settings_text()

			expect(transform_copied_content(destination, source)).not.toContain(
				`sh ${hook_launch.RUN_HOOK_SCRIPT}`,
			)
		},
	)

	it('runs the installed bundle from a project subdirectory', () => {
		const source = JSON.stringify({
			command: hook_launch.hook_launch_command('pretool-guard'),
		})
		const { command } = JSON.parse(rewrite_hook_commands(source)) as { command: string }
		const result = hook_command_bootstrap.run_in_temporary_checkout(command, true, true)

		expect(result.status).toBe(0)
		expect(result.stdout).toBe(GUARD_OUTPUT)
	})
})
