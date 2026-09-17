import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prompt_hooks } from '#scripts/hooks/prompt-hooks'
import { init_logic } from '#scripts/init/init-logic'
import { describe, expect, it } from 'vitest'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENT_SKILLS = path.join(ROOT, '.agents', 'skills')
const CLAUDE_SKILLS = path.join(ROOT, '.claude', 'skills')
const CODEX_CONFIG = path.join(ROOT, '.codex', 'config.toml')
const CODEX_HOOKS = path.join(ROOT, '.codex', 'hooks.json')
const CLAUDE_SETTINGS = path.join(ROOT, '.claude', 'settings.json')
const CODEX_ROOTS = ['.agents', '.codex']
const CODEX_PRETOOL_COMMAND =
	'if [ -f dist/hooks/codex-hook-adapter.js ]; then node dist/hooks/codex-hook-adapter.js pretool; else pnpm exec tsx scripts/hooks/codex-hook-adapter.ts pretool; fi'
const CODEX_POSTTOOL_COMMAND =
	'if [ -f dist/hooks/codex-hook-adapter.js ]; then node dist/hooks/codex-hook-adapter.js posttool; else pnpm exec tsx scripts/hooks/codex-hook-adapter.ts posttool; fi'

interface HookHandler {
	type: string
	command: string
	timeout?: number
}

interface MatcherGroup {
	matcher?: string
	hooks: Array<HookHandler>
}

interface HookConfig {
	hooks: Record<string, Array<MatcherGroup>>
}

function read(file_path: string): string {
	return readFileSync(file_path, 'utf8')
}

function load_hooks(file_path: string): HookConfig {
	return JSON.parse(read(file_path)) as HookConfig
}

function is_codex_project_path(file_path: string): boolean {
	return CODEX_ROOTS.some((root) => file_path === root || file_path.startsWith(`${root}/`))
}

function first_handler(hooks: HookConfig['hooks'], event: string): HookHandler {
	const handler = hooks[event]?.[0]?.hooks[0]
	if (handler === undefined) throw new Error(`Missing ${event} hook handler`)

	return handler
}

function normalize_adapter_command(
	normalized: HookConfig['hooks'],
	claude: HookConfig['hooks'],
	event: string,
	expected: string,
): void {
	const target = first_handler(normalized, event)
	if (target.command !== expected) throw new Error(`Unexpected ${event} adapter command`)

	target.command = first_handler(claude, event).command
}

function normalize_codex_hooks(codex: HookConfig, claude: HookConfig): HookConfig['hooks'] {
	const normalized = structuredClone(codex.hooks)

	normalize_adapter_command(normalized, claude.hooks, 'PreToolUse', CODEX_PRETOOL_COMMAND)
	normalize_adapter_command(normalized, claude.hooks, 'PostToolUse', CODEX_POSTTOOL_COMMAND)
	const prompt_group = normalized['UserPromptSubmit']?.[0]
	if (prompt_group === undefined) throw new Error('Missing UserPromptSubmit hook group')
	// Codex documents that UserPromptSubmit ignores matcher, so its omission is intentional.
	prompt_group.matcher = ''

	return normalized
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

		expect(hooks).toContain('codex-hook-adapter.js pretool')
		expect(hooks).toContain('codex-hook-adapter.js posttool')
		expect(hooks).toContain('pnpm josh audit:provision')
		expect(hooks).toContain('pnpm josh session:lang')
	})

	it('keeps prompt-time rules aligned with the Claude workflow', () => {
		const codex_commands = prompt_hooks.user_prompt_hook_commands(read(CODEX_HOOKS))
		const claude_commands = prompt_hooks.user_prompt_hook_commands(read(CLAUDE_SETTINGS))

		expect(codex_commands).toStrictEqual(claude_commands)
	})
})

describe('Codex and Claude hook parity', () => {
	it('matches the complete Claude hook structure apart from the Codex adapter', () => {
		const codex = load_hooks(CODEX_HOOKS)
		const claude = load_hooks(CLAUDE_SETTINGS)

		expect(normalize_codex_hooks(codex, claude)).toStrictEqual(claude.hooks)
	})
})

describe('josh setup and sync boundaries', () => {
	it('does not recreate repository-local Codex configuration as distributed copies', () => {
		const destinations = [
			...init_logic.get_ai_copy_files(),
			...init_logic.get_ai_copy_file_mappings().map((mapping) => mapping.dest),
			...init_logic.get_ai_copy_directories(),
		]

		expect(destinations.some((destination) => is_codex_project_path(destination))).toBe(false)
	})
})
