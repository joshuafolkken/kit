import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import {
	claude_settings_fixture,
	type HookHandler,
	type HookMatcher,
} from './claude-settings-fixture'
import { PROCESS_TIMEOUT_MS } from './format-edited-file'

const GITIGNORE_PATH = fileURLToPath(new URL('../.gitignore', import.meta.url))

// #852: the innermost feedback loop is one edited file, and before this hook the only way to see
// what prettier and eslint made of it was a whole-project run. The command has to stay a `josh`
// subcommand: a shell one-liner here would be a second copy of the logic in every consumer.
const FORMAT_HOOK_COMMAND = 'pnpm josh format:edited'
// Derived from the script's own per-formatter bound rather than written as a number: raising that
// bound has to raise the declared budget with it, or the harness kills a run the script still
// considers healthy. Two formatters, plus a process-startup allowance.
const FORMATTER_RUNS = 2
const STARTUP_ALLOWANCE_SECONDS = 10
const MS_PER_SECOND = 1000
const MINIMUM_HOOK_TIMEOUT_SECONDS =
	(PROCESS_TIMEOUT_MS / MS_PER_SECOND) * FORMATTER_RUNS + STARTUP_ALLOWANCE_SECONDS

// The formatting hook specifically, not every `PostToolUse` entry and not every handler of the entry
// that owns it: a guard that scans siblings can be satisfied — or broken — by an unrelated hook
// added later.
function format_matchers(): ReadonlyArray<HookMatcher> {
	const matchers = claude_settings_fixture.load_settings().hooks.PostToolUse ?? []

	return matchers.filter((entry) =>
		entry.hooks.some((handler) => handler.command === FORMAT_HOOK_COMMAND),
	)
}

function format_handlers(): ReadonlyArray<HookHandler> {
	return format_matchers()
		.flatMap((entry) => entry.hooks)
		.filter((handler) => handler.command === FORMAT_HOOK_COMMAND)
}

describe('.claude/settings.json — post-edit formatting hook', () => {
	it('runs after an edit lands', () => {
		const matchers = format_matchers()

		expect(matchers.length).toBeGreaterThan(0)
	})

	it.each(['Edit', 'Write'])('covers the %s tool', (tool_name) => {
		const is_covered = format_matchers().some((entry) => entry.matcher.includes(tool_name))

		expect(is_covered).toBe(true)
	})

	it('formats through the josh subcommand rather than an inline shell copy', () => {
		const commands = format_handlers().map((handler) => handler.command)

		expect(commands).toContain(FORMAT_HOOK_COMMAND)
	})

	// Two formatter starts have to finish inside whatever budget the harness allows the hook, because
	// a kill landing inside `prettier --write` truncates the file the agent just wrote. Declaring the
	// budget here is what keeps the script's own per-command limits the binding ones.
	it('declares a timeout longer than the two formatter runs it starts', () => {
		const timeouts = format_handlers().map((handler) => handler.timeout ?? 0)

		expect(timeouts.length).toBeGreaterThan(0)
		expect(Math.min(...timeouts)).toBeGreaterThanOrEqual(MINIMUM_HOOK_TIMEOUT_SECONDS)
	})

	// The settings file names the subcommand as a string, so a rename on the josh side would leave a
	// hook that fails on every edit with nothing pointing at the cause.
	it('names a subcommand josh actually has', () => {
		const subcommand = FORMAT_HOOK_COMMAND.split(' ').at(-1) ?? ''

		expect(Object.keys(COMMAND_MAP)).toContain(subcommand)
	})
})

describe('.claude/settings.json — deletion-policy hook reconciliation', () => {
	it('frames git-tracked deletion as reversible and not a Tier C action', () => {
		const raw = claude_settings_fixture.read_settings_text()

		expect(raw).toContain('git restore')
		expect(raw).toMatch(/reversible/u)
		expect(raw).toMatch(/Tier C/u)
	})

	it('still requires inspecting the target before deleting', () => {
		const raw = claude_settings_fixture.read_settings_text()

		expect(raw).toMatch(/inspect the target first/u)
		expect(raw).not.toContain('proceed directly')
	})
})

describe('.gitignore — Claude Code runtime artifacts', () => {
	it('ignores .claude/scheduled_tasks.lock so it never lands in commits', () => {
		const gitignore = readFileSync(GITIGNORE_PATH, 'utf8')

		expect(gitignore).toMatch(/^\.claude\/scheduled_tasks\.lock$/mu)
	})
})
