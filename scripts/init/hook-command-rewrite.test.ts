import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { describe, expect, it } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_command_rewrite } from './hook-command-rewrite'
import { hook_launch } from './hook-launch'
import { transform_copied_content } from './init-copy-content'

const { apply_hook_command_rewrite_for_destination, is_kit_hook_command, rewrite_hook_commands } =
	hook_command_rewrite
const { consumer_command } = hook_command_bootstrap
const { CLAUDE_ROOT, CODEX_ROOT, RUN_HOOK_SCRIPT } = hook_launch
const SETTINGS_DESTINATION = path.join('.claude', 'settings.json')
const CODEX_HOOKS_DESTINATION = path.join('.codex', 'hooks.json')
const CODEX_HOOKS_SOURCE = fileURLToPath(new URL('../../.codex/hooks.json', import.meta.url))
const SESSION_LANG_COMMAND = '{"command": "pnpm josh session:lang"}'
const PRETOOL_GUARD = 'pretool-guard'
// A kit-side launcher command: the hook launcher picks the built bundle or the live source itself.
const KIT_LAUNCHER_COMMAND = hook_launch.hook_launch_command(PRETOOL_GUARD)
const CODEX_LAUNCHER_COMMAND = hook_launch.codex_command(KIT_LAUNCHER_COMMAND)
const INSTALLED_PACKAGE = 'node_modules/@joshuafolkken/kit'
const RELATIVE_CONSUMER_LAUNCHER = `sh ./${INSTALLED_PACKAGE}/${RUN_HOOK_SCRIPT}`
const INSTALL_NOTICE = 'run pnpm install, then reread CLAUDE.md'
const RELATIVE_JOSH_COMMAND = `node ./${INSTALLED_PACKAGE}/dist/josh.js`
const ROOT_COMMAND = 'git rev-parse --show-toplevel'
const LEGACY_LOCATION_VARIABLES =
	'GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_DIR GIT_INDEX_FILE GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_WORK_TREE'
const LEGACY_ROOT_PREFIX = `if project_root="$(unset ${LEGACY_LOCATION_VARIABLES}; ${ROOT_COMMAND} 2>/dev/null)"; then unset ${LEGACY_LOCATION_VARIABLES}; else project_root="$(${ROOT_COMMAND})"; fi && cd "$project_root" && `
const PRE_WORKTREE_ROOT_PREFIX = `project_root="\${CLAUDE_PROJECT_DIR:-$( (unset ${LEGACY_LOCATION_VARIABLES}; ${ROOT_COMMAND} 2>/dev/null) || ${ROOT_COMMAND})}" && cd "$project_root" && `
const PRE_LAUNCHER_ROOT_PREFIX = `export JOSH_HOOK_CWD="$PWD" && ${PRE_WORKTREE_ROOT_PREFIX}`
const RELATIVE_INSTALL_GUARD = `if [ ! -f ./${INSTALLED_PACKAGE}/package.json ]; then echo 'kit hooks inactive: ${INSTALL_NOTICE}' >&2; exit 0; fi; `
const INSTALLED_LAUNCHER = `${INSTALLED_PACKAGE}/${RUN_HOOK_SCRIPT}`
const INSTALLED_DISPATCHER = `${INSTALLED_PACKAGE}/dist/josh.js`

function consumer_launcher(root: string): string {
	return `sh ${hook_launch.rooted_path(root, INSTALLED_LAUNCHER)}`
}

function consumer_josh_command(root: string): string {
	return `node ${hook_launch.rooted_path(root, INSTALLED_DISPATCHER)}`
}

function hook_commands(settings_text: string): ReadonlyArray<string> {
	const { hooks } = JSON.parse(settings_text) as ReturnType<
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

function consumer_hook_commands(): ReadonlyArray<string> {
	return hook_commands(
		transform_copied_content(SETTINGS_DESTINATION, claude_settings_fixture.read_settings_text()),
	)
}

function source_hook_commands(): ReadonlyArray<string> {
	return hook_commands(claude_settings_fixture.read_settings_text())
}

describe('rewrite_hook_commands', () => {
	it('replaces a pnpm josh hook command with the node bundle invocation', () => {
		const command = consumer_command('pnpm josh pretool:guard')

		expect(command).toContain(INSTALL_NOTICE)
		expect(command).toContain(`${consumer_josh_command(CLAUDE_ROOT)} pretool:guard`)
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
		const command = consumer_command(KIT_LAUNCHER_COMMAND)

		expect(command).toContain(INSTALL_NOTICE)
		expect(command).toContain(`${consumer_launcher(CLAUDE_ROOT)} ${PRETOOL_GUARD}`)
	})

	// The rebased launcher path still ends in the source path, so a blind rerun would rewrite it onto
	// itself. A second pass over already-rewritten output must be a no-op (joshuafolkken/kit#2023).
	it.each([
		['Claude Code', KIT_LAUNCHER_COMMAND, false],
		['Codex', CODEX_LAUNCHER_COMMAND, true],
	])(
		'is idempotent under %s — a second rewrite leaves an already-rebased command unchanged',
		(_agent, command, is_codex) => {
			const once = rewrite_hook_commands(JSON.stringify({ command }), is_codex)

			expect(rewrite_hook_commands(once, is_codex)).toBe(once)
		},
	)
})

describe('rewrite_hook_commands over an unsynced consumer file', () => {
	// A consumer's file still carries a shape kit wrote before joshuafolkken/kit#4187, #4617 or #6033:
	// a root prefix, then the launcher relative to the root behind a relative install guard.
	it.each([
		['#4187', LEGACY_ROOT_PREFIX],
		['#4617', PRE_WORKTREE_ROOT_PREFIX],
		['#6033', PRE_LAUNCHER_ROOT_PREFIX],
	])('replaces the command shape from before %s with the current one', (_issue, legacy_prefix) => {
		const legacy_command = `${legacy_prefix}${RELATIVE_INSTALL_GUARD}${RELATIVE_CONSUMER_LAUNCHER} ${PRETOOL_GUARD}`

		expect(consumer_command(legacy_command)).toBe(consumer_command(KIT_LAUNCHER_COMMAND))
	})

	it('replaces the relative launcher kit itself named before #6033', () => {
		const legacy_command = `${PRE_LAUNCHER_ROOT_PREFIX}sh ${RUN_HOOK_SCRIPT} ${PRETOOL_GUARD}`

		expect(consumer_command(legacy_command, true)).toBe(
			consumer_command(CODEX_LAUNCHER_COMMAND, true),
		)
	})
})

describe('apply_hook_command_rewrite_for_destination', () => {
	it('rebases Codex hook commands to the installed launcher', () => {
		const source = readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
		const transformed = transform_copied_content(CODEX_HOOKS_DESTINATION, source)

		expect(JSON.parse(transformed)).toHaveProperty('hooks')

		const commands = hook_commands(transformed).filter((command) =>
			command.includes('codex-hook-adapter'),
		)

		expect(commands).toHaveLength(2)

		for (const command of commands) {
			expect(command).toContain(`${consumer_launcher(CODEX_ROOT)} codex-hook-adapter`)
		}
	})

	it('keeps the Codex hook rewrite stable when applied twice', () => {
		const source = readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
		const once = transform_copied_content(CODEX_HOOKS_DESTINATION, source)

		expect(transform_copied_content(CODEX_HOOKS_DESTINATION, once)).toBe(once)
	})

	it('rewrites only the consumer .claude/settings.json destination', () => {
		const { command } = JSON.parse(
			apply_hook_command_rewrite_for_destination(SETTINGS_DESTINATION, SESSION_LANG_COMMAND),
		) as { command: string }

		expect(command).toContain(`${consumer_josh_command(CLAUDE_ROOT)} session:lang`)
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

	// The session-start provisioner was the last hook calling the josh dispatcher directly; it moved to
	// the shared launcher (joshuafolkken/kit#3256), so every kit hook now pays only a bundle start.
	it('runs no hook through the josh dispatcher', () => {
		const josh_hooks = consumer_hook_commands().filter((command) =>
			command.includes(INSTALLED_DISPATCHER),
		)

		expect(josh_hooks).toEqual([])
	})

	// The per-hook bundles are launched from the installed package, so a consumer's guarded call pays
	// neither a pnpm launch nor the dispatcher's tsx re-spawn (joshuafolkken/kit#2023).
	it('launches each per-hook bundle through the installed launcher under the named root', () => {
		const bundle_hooks = consumer_hook_commands().filter((command) =>
			command.includes(RUN_HOOK_SCRIPT),
		)

		expect(bundle_hooks.length).toBeGreaterThan(0)

		for (const command of bundle_hooks) {
			expect(command).toContain(`${consumer_launcher(CLAUDE_ROOT)} `)
		}
	})
})

describe('is_kit_hook_command', () => {
	it('recognizes every hook kit distributes, as kit names it', () => {
		expect(source_hook_commands().length).toBeGreaterThan(0)
		expect(source_hook_commands().filter((command) => !is_kit_hook_command(command))).toEqual([])
	})

	it('recognizes every hook kit distributes, as a consumer receives it', () => {
		expect(consumer_hook_commands().filter((command) => !is_kit_hook_command(command))).toEqual([])
	})

	it.each([
		`${RELATIVE_JOSH_COMMAND} batch:guard`,
		`${RELATIVE_INSTALL_GUARD}${RELATIVE_CONSUMER_LAUNCHER} ${PRETOOL_GUARD}`,
		`sh ${RUN_HOOK_SCRIPT} ${PRETOOL_GUARD}`,
	])('recognizes a hook an earlier release wrote: %s', (command) => {
		expect(is_kit_hook_command(command)).toBe(true)
	})

	// Until joshuafolkken/kit#1930 a consumer received `pnpm josh <command>` as it stands in kit's file.
	it.each([
		'pnpm josh audit:provision',
		'pnpm josh batch:guard',
		'pnpm josh format:edited',
		'pnpm josh investigation:guard',
		'pnpm josh rule:guard',
		'pnpm josh session:lang',
	])('recognizes a hook kit distributed before any rewrite: %s', (command) => {
		expect(is_kit_hook_command(command)).toBe(true)
	})

	it.each([
		'sh scripts/notify-team.sh',
		'pnpm josh lint',
		'pnpm josh format:edited && sh scripts/notify-team.sh',
		"echo 'run-hook.sh'",
	])("leaves a project's own command alone: %s", (command) => {
		expect(is_kit_hook_command(command)).toBe(false)
	})
})

// kit's own hook commands pass the bundle-ready gate (joshuafolkken/kit#2984); the copy a consumer
// receives must carry the install guard once and swap the gate — whose script ships only in kit's
// checkout — for a presence check.
describe("kit's own launch command as a consumer receives it", () => {
	it('carries the install guard at most once', () => {
		for (const command of consumer_hook_commands()) {
			expect(command.split(INSTALL_NOTICE).length).toBeLessThanOrEqual(2)
		}
	})

	it.each([
		[SETTINGS_DESTINATION, CLAUDE_ROOT],
		[CODEX_HOOKS_DESTINATION, CODEX_ROOT],
	])('launches no hook from the source tree in %s', (destination, root) => {
		const source =
			destination === CODEX_HOOKS_DESTINATION
				? readFileSync(CODEX_HOOKS_SOURCE, 'utf8')
				: claude_settings_fixture.read_settings_text()
		const transformed = transform_copied_content(destination, source)

		expect(transformed).not.toContain(`${root}/${RUN_HOOK_SCRIPT}`)
		expect(transformed).not.toContain(`sh ${RUN_HOOK_SCRIPT}`)
	})
})
