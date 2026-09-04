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
// Derived from the script's own per-spawn bound rather than written as a number: raising that bound
// has to raise the declared budget with it, or the harness kills a run the script still considers
// healthy — and it lands at a moment the script did not choose, possibly inside `prettier --write`.
// The count is the worst-case *run*, not the number of formatters (joshuafolkken/kit#1259): an edit
// to an eslint config input plans eslint, prettier and `eslint_d restart`, and eslint and the
// restart each carry a second route behind the daemon that is tried when it fails to start.
const FORMATTER_RUNS = 5
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

// The tools the formatting hook's matchers name, read the way Claude Code reads them: an exact list
// separated by `|`. Split rather than a substring test, because `BashOutput` contains `Bash` — a
// matcher that had drifted to the wrong tool would satisfy a `includes` check for the right one.
function matched_tools(): ReadonlySet<string> {
	return new Set(format_matchers().flatMap((entry) => entry.matcher.split('|')))
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

	// `Bash` joined the two edit tools in joshuafolkken/kit#1337. The live density line rides this
	// hook, and 7 of the 10 most recent sessions in this checkout never called `Edit` or `Write` once
	// — they edit through `sed` instead, and they are exactly the sessions measured under the floor at
	// 1.00–1.31. `Bash` is 88–100% of every one of their calls, so naming it reaches all of them,
	// while naming every tool would buy no further reach and put a process start in front of the
	// read-only calls this hook has nothing to say about.
	it.each(['Edit', 'Write', 'Bash'])('covers the %s tool', (tool_name) => {
		expect(matched_tools().has(tool_name)).toBe(true)
	})

	// Claude Code reads a matcher built only from letters, digits, `_`, `-`, spaces, `,` and `|` as an
	// exact list of tool names, and anything else as an unanchored regular expression. Since `Bash`
	// joined the list that difference decides a real case, because `Bash` is a prefix of `BashOutput`:
	// read as a regex the list form catches that tool too — a few spare spawns and nothing worse —
	// while an anchored `^(Edit|Write|Bash)$` read as a *list* names no existing tool at all and the
	// hook silently stops running. This pins the form whose failure is the bounded one.
	it('names its tools as an exact list rather than a regular expression', () => {
		const matchers = format_matchers().map((entry) => entry.matcher)

		expect(matchers.length).toBeGreaterThan(0)

		for (const matcher of matchers) expect(matcher).toMatch(/^[\w\-, |]+$/u)
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
