import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { codex_hooks, type HookConfig } from '#scripts/agent/codex-hooks'
import { hook_launch } from '#scripts/init/hook-launch'
import { init_logic } from '#scripts/init/init-logic'
import { prompt_hooks } from '#tools/hooks/prompt-hooks'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENT_SKILLS = path.join(ROOT, '.agents', 'skills')
const CLAUDE_SKILLS = path.join(ROOT, '.claude', 'skills')
const CODEX_CONFIG = path.join(ROOT, '.codex', 'config.toml')
const CODEX_HOOKS = path.join(ROOT, '.codex', 'hooks.json')
const CLAUDE_SETTINGS = path.join(ROOT, '.claude', 'settings.json')

function read(file_path: string): string {
	return readFileSync(file_path, 'utf8')
}

function load_hooks(file_path: string): HookConfig {
	return JSON.parse(read(file_path)) as HookConfig
}

describe('Codex skill discovery', () => {
	it('uses the Claude skill source through one repository-relative link', () => {
		expect(lstatSync(AGENT_SKILLS).isSymbolicLink()).toBe(true)
		expect(readlinkSync(AGENT_SKILLS)).toBe('../.claude/skills')
		expect(realpathSync(AGENT_SKILLS)).toBe(realpathSync(CLAUDE_SKILLS))
	})

	it('exposes the canonical workflow skill without copying it', () => {
		const relative_skill = path.join('workflow-commands', 'SKILL.md')

		expect(read(path.join(AGENT_SKILLS, relative_skill))).toBe(
			read(path.join(CLAUDE_SKILLS, relative_skill)),
		)
	})
})

describe('Codex project settings', () => {
	it('keeps the shell environment and Svelte MCP project settings', () => {
		const config = read(CODEX_CONFIG)

		expect(config).toContain('[shell_environment_policy]')
		expect(config).toContain('BASH_MAX_OUTPUT_LENGTH = "8000"')
		expect(config).toContain('[mcp_servers.svelte]')
		expect(config).toContain('url = "https://mcp.svelte.dev/mcp"')
	})
})

describe('Codex hook wiring', () => {
	it.each(['PreToolUse', 'PostToolUse'])('matches apply_patch during %s', (event) => {
		const matcher = load_hooks(CODEX_HOOKS).hooks[event]?.[0]?.matcher

		expect(matcher?.split('|')).toContain('apply_patch')
	})

	it.each(['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit'])(
		'keeps the %s hook event',
		(event) => {
			const hooks = read(CODEX_HOOKS)
			const parsed: unknown = JSON.parse(hooks)

			expect(parsed).toBeDefined()
			expect(hooks).toContain(`"${event}"`)
		},
	)

	it('runs the Codex adapter and the provider-independent kit hooks', () => {
		const hooks = read(CODEX_HOOKS)

		for (const hook of [
			'codex-hook-adapter pretool',
			'codex-hook-adapter posttool',
			'audit-provision',
			'session-lang',
		]) {
			expect(hooks).toContain(String.raw`run-hook.sh\" ${hook}`)
		}
	})

	// Codex names its hooks' root through git rather than `CLAUDE_PROJECT_DIR`; the rest is the same.
	it('keeps prompt-time rules aligned with the Claude workflow', () => {
		const codex_commands = prompt_hooks.user_prompt_hook_commands(read(CODEX_HOOKS))
		const claude_commands = prompt_hooks
			.user_prompt_hook_commands(read(CLAUDE_SETTINGS))
			.map((command) => hook_launch.codex_command(command))

		expect(codex_commands).toStrictEqual(claude_commands)
	})
})

// A lane runs the main checkout's trusted hooks.json (joshuafolkken/kit#6658), so every command
// must find its scripts through the running work tree rather than a fixed path.
describe('Codex hooks in a lane', () => {
	it('resolves every hook command from the running work tree', () => {
		const handlers = Object.values(load_hooks(CODEX_HOOKS).hooks)
			.flat()
			.flatMap((group) => group?.hooks ?? [])

		expect(handlers.length).toBeGreaterThan(0)

		for (const handler of handlers) {
			expect(handler.command).toMatch(
				/^sh "\$\( \(unset GIT_DIR GIT_WORK_TREE; git rev-parse --show-toplevel/u,
			)
		}
	})
})

// `.codex/hooks.json` is generated from `.claude/settings.json` (joshuafolkken/kit#2997), so the
// committed copy has to be exactly what the generator prints for the current Claude settings.
describe('Codex and Claude hook parity', () => {
	it('is the file the generator derives from the Claude settings', () => {
		expect(read(CODEX_HOOKS), 'regenerate with `tsx scripts/build/build-codex-hooks.ts`').toBe(
			codex_hooks.codex_hooks_text(read(CLAUDE_SETTINGS)),
		)
	})
})

describe('josh setup and sync boundaries', () => {
	it('distributes Codex project files without copying the local skill link', () => {
		const destinations = [
			...init_logic.get_ai_copy_files(),
			...init_logic.get_ai_copy_file_mappings().map((mapping) => mapping.dest),
			...init_logic.get_ai_copy_directories(),
		]

		expect(destinations).toContain('.codex/config.toml')
		expect(destinations).toContain('.codex/hooks.json')
		expect(destinations.some((destination) => destination.startsWith('.agents/'))).toBe(false)
	})
})
