import { hook_launch } from '#scripts/init/hook-launch'
import { describe, expect, it } from 'vitest'
import { codex_hooks, type HookConfig } from './codex-hooks'

const PRETOOL_GUARD = hook_launch.hook_launch_command('pretool-guard.js', 'pretool:guard')
const FORMAT_EDITED = hook_launch.hook_launch_command('format-edited.js', 'format:edited')
const PROMPT_ECHO = "echo 'rule'"
const TOOL_MATCHER = 'Bash|Edit'
const PROMPT_TIMEOUT = 10
const COMMAND_TYPE = 'command'
const STOP_GUARD = 'pnpm josh stop:guard'

function claude_settings(): HookConfig {
	return {
		hooks: {
			UserPromptSubmit: [
				{
					matcher: '',
					hooks: [{ type: COMMAND_TYPE, command: PROMPT_ECHO, timeout: PROMPT_TIMEOUT }],
				},
			],
			PreToolUse: [
				{ matcher: TOOL_MATCHER, hooks: [{ type: COMMAND_TYPE, command: PRETOOL_GUARD }] },
			],
			PostToolUse: [{ matcher: 'Edit', hooks: [{ type: COMMAND_TYPE, command: FORMAT_EDITED }] }],
			Stop: [{ matcher: '', hooks: [{ type: COMMAND_TYPE, command: STOP_GUARD }] }],
		},
	}
}

function derived_group(event: string): HookConfig['hooks'][string][number] {
	const group = codex_hooks.codex_hook_config(claude_settings()).hooks[event]?.[0]
	if (group === undefined) throw new Error(`Missing ${event} group`)

	return group
}

function derived_command(event: string): string | undefined {
	return derived_group(event).hooks[0]?.command
}

describe('codex_hook_config', () => {
	it('routes the pretool and posttool guards through the Codex adapter', () => {
		expect(derived_command('PreToolUse')).toBe(codex_hooks.adapter_command('pretool'))
		expect(derived_command('PostToolUse')).toBe(codex_hooks.adapter_command('posttool'))
	})

	it('adds apply_patch to the tool-event matchers only', () => {
		expect(derived_group('PreToolUse').matcher).toBe(`${TOOL_MATCHER}|apply_patch`)
		expect(derived_group('PostToolUse').matcher).toBe('Edit|apply_patch')
		expect(derived_group('Stop').matcher).toBe('')
	})

	it('drops the matcher Codex ignores on UserPromptSubmit and keeps every other field', () => {
		expect(derived_group('UserPromptSubmit')).toStrictEqual({
			hooks: [{ type: COMMAND_TYPE, command: PROMPT_ECHO, timeout: PROMPT_TIMEOUT }],
		})
	})

	it('passes a command the adapter does not replace through unchanged', () => {
		expect(derived_command('Stop')).toBe(STOP_GUARD)
	})

	it('keeps the Claude event order', () => {
		const settings = claude_settings()
		const events = Object.keys(codex_hooks.codex_hook_config(settings).hooks)

		expect(events).toStrictEqual(Object.keys(settings.hooks))
	})
})

describe('codex_hooks_text', () => {
	it('prints tab-indented JSON with a trailing newline', () => {
		const text = codex_hooks.codex_hooks_text(JSON.stringify(claude_settings()))

		expect(text.endsWith('}\n')).toBe(true)
		expect(text).toContain('\n\t"hooks": {')
		expect(JSON.parse(text)).toStrictEqual(codex_hooks.codex_hook_config(claude_settings()))
	})
})
