import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROCESS_TIMEOUT_MS } from '#scripts/hooks/format-edited-file'
import { hook_launch } from '#scripts/init/hook-launch'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { security_audit_provision_logic } from '#scripts/security/security-audit-provision-logic'
import { describe, expect, it } from 'vitest'
import {
	claude_settings_fixture,
	type HookHandler,
	type HookMatcher,
	type HooksBlock,
} from './claude-settings-fixture'

const GITIGNORE_PATH = fileURLToPath(new URL('../../.gitignore', import.meta.url))

// #852: the innermost feedback loop is one edited file, and before this hook the only way to see
// what prettier and eslint made of it was a whole-project run. The hook launches the pre-built
// bundle directly and drops to the `pnpm josh` subcommand only when it is absent
// (joshuafolkken/kit#2023) — the formatter's logic still lives in that one subcommand/bundle, never
// copied into settings, and the launch shape itself is single-sourced in `hook_launch`.
const FORMAT_HOOK_COMMAND = hook_launch.hook_launch_command('format-edited.js', 'format:edited')
// The consolidated PreToolUse guard (joshuafolkken/kit#1930): one process that runs the batching
// guard (joshuafolkken/kit#1390), the investigation guard (joshuafolkken/kit#1460) and the rule
// delivery guard (joshuafolkken/kit#1524) in turn. `PreToolUse` is the only event that can still stop
// a call, and folding the three into one is two process starts saved on every guarded call — three
// launches on every consumer's Bash call became one. Launched from its own bundle with a `pnpm josh`
// fallback (joshuafolkken/kit#2023).
const PRETOOL_GUARD_HOOK_COMMAND = hook_launch.hook_launch_command(
	'pretool-guard.js',
	'pretool:guard',
)
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
// The guard starts no formatter, so its budget only has to cover one script start and a
// quarter-megabyte read. Declared all the same: a `PreToolUse` hook holds the call it guards, and a
// kill at an undeclared default would land on a decision the script had not finished making.
const MINIMUM_GUARD_TIMEOUT_SECONDS = STARTUP_ALLOWANCE_SECONDS

// The separators the exact-list form admits — `|` and `,`, with any surrounding space trimmed off.
// Splitting on `|` alone would read the equally valid `"Edit, Write, Bash"` as one tool named
// `Edit, Write, Bash` and fail every case below on a settings file that is correct.
const TOOL_SEPARATORS = /[|,]/u
// The formatter formats the file an edit named, so it needs exactly the two edit tools. `Bash` was
// dropped from the matcher (joshuafolkken/kit#1930): a shell call has no edited file to format, so
// running the formatter after every `Bash` was overhead every consumer paid on every command. The
// density line it used to also carry (joshuafolkken/kit#1337) is not worth that per-call cost, and
// the batching it fed now rides the consolidated PreToolUse guard, which does intervene before the call.
const FORMAT_TOOLS = ['Edit', 'Write']
// The union of the three composed guards' matchers, since one process now answers for all of them.
// `Bash` is where the rule delivery guard (joshuafolkken/kit#1524) and the read-only half of the
// batching guard bind; `Edit` carries the largest share of the batching guard's recoverable round
// trips (joshuafolkken/kit#1762); `Read` is the shape a run spends most of its investigation in
// (joshuafolkken/kit#1798); `Write` earns the batching guard's non-blocking notice
// (joshuafolkken/kit#1848). Each composed guard self-gates on the tool name inside its own candidate
// test, so naming the union is safe — a guard the call does not concern returns "allow" without ever
// reading the transcript.
const PRETOOL_GUARD_TOOLS = ['Bash', 'Edit', 'Read', 'Write']
// The audit provisioner (joshuafolkken/kit#1563). `SessionStart` is the one event that fires before
// any work is attempted, which is what makes the pre-push audit's missing binary a solved problem
// rather than a push that dies after the unit suite has already run.
const PROVISION_HOOK_COMMAND = 'pnpm josh audit:provision'
// Derived from the download's own bound for the reason the formatter's is: a harness kill lands
// mid-write, and the staging file this script renames from is the only thing that makes that
// survivable. Raising the download budget has to raise the declared timeout with it.
const MINIMUM_PROVISION_TIMEOUT_SECONDS =
	security_audit_provision_logic.SESSION_DOWNLOAD_TIMEOUT_MS / MS_PER_SECOND +
	STARTUP_ALLOWANCE_SECONDS
// The session-language hook (joshuafolkken/kit#1903): resolves JOSH_SESSION_LANG and prints it to
// stdout, so a SessionStart / UserPromptSubmit hook injects the value into context every turn. It
// starts no download and reads no large file, so one script start is its whole budget. Launched from
// its own bundle with a `pnpm josh` fallback (joshuafolkken/kit#2023).
const SESSION_LANG_HOOK_COMMAND = hook_launch.hook_launch_command('session-lang.js', 'session:lang')
const MINIMUM_SESSION_LANG_TIMEOUT_SECONDS = STARTUP_ALLOWANCE_SECONDS
// The per-turn echoes are injected on every prompt, so each stays bounded (joshuafolkken/kit#1930).
// The work-summary reminder carries every behavioral directive `prompt-hook-brevity.test.ts` pins
// (its REQUIRED_DIRECTIVES) and points at the full rule in `CLAUDE.md`, which lands it near 800
// characters. The real per-turn budget is the joined-text ceiling that suite owns (1,100 bytes); this
// per-echo bound only has to keep a single reminder from growing past that same ceiling on its own.
const ECHO_MAX_LENGTH = 1100

// Compared as sets, so the two sides are ordered the same way first. `localeCompare` rather than the
// default, which sorts by code unit and is what the lint rule here is about.
function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

type HookEvent = keyof HooksBlock

// One hook of the distributed settings file: the event it is wired to, the command that identifies it
// among that event's entries, and the budget it has to declare.
interface HookWiring {
	event: HookEvent
	command: string
	minimum_timeout_seconds: number
}

// A hook whose event carries a tool matcher. `SessionStart` does not — it fires on a session
// beginning rather than on a call — so the tool assertions below are declared on this narrower shape
// and the three properties every hook holds stay in the one block both kinds run.
interface ToolHookWiring extends HookWiring {
	tools: ReadonlyArray<string>
}

// This hook's matchers specifically, not every entry of its event and not every handler of the entry
// that owns it: a guard that scans siblings can be satisfied — or broken — by an unrelated hook added
// later. Filtering on the command is also what pins the hook to a `josh` subcommand rather than an
// inline shell copy of the same logic.
function matchers_of(wiring: HookWiring): ReadonlyArray<HookMatcher> {
	const matchers = claude_settings_fixture.load_settings().hooks[wiring.event] ?? []

	return matchers.filter((entry) =>
		entry.hooks.some((handler) => handler.command === wiring.command),
	)
}

function handlers_of(wiring: HookWiring): ReadonlyArray<HookHandler> {
	return matchers_of(wiring)
		.flatMap((entry) => entry.hooks)
		.filter((handler) => handler.command === wiring.command)
}

// The tools a hook's matchers name, read the way Claude Code reads them: an exact list. Split rather
// than a substring test, because `BashOutput` contains `Bash` — a matcher that had drifted to the
// wrong tool would satisfy an `includes` check for the right one.
function tools_of(wiring: ToolHookWiring): ReadonlySet<string> {
	return new Set(
		matchers_of(wiring).flatMap((entry) =>
			entry.matcher.split(TOOL_SEPARATORS).map((tool) => tool.trim()),
		),
	)
}

// The three properties every hook in this file holds, whatever event it rides. Written once because
// `SessionStart` (joshuafolkken/kit#1563) joined the tool hooks here and shares all three; the two
// tool-matcher assertions stay with the tool hooks, which are the only ones a matcher means anything
// to. `CLAUDE.md` → "No clones" is why this is a shared block rather than a second copy.
function describe_shared_hook_properties(wiring: HookWiring): void {
	it('is wired to its event through the josh subcommand', () => {
		expect(matchers_of(wiring).length).toBeGreaterThan(0)
	})

	// Whatever the hook starts has to finish inside the budget the harness allows it, because a kill
	// lands at a moment the script did not choose — inside `prettier --write` it truncates the file
	// the agent just wrote. Declaring the budget here is what keeps each script's own limits binding.
	it('declares a timeout the run it starts fits inside', () => {
		const timeouts = handlers_of(wiring).map((handler) => handler.timeout ?? 0)

		expect(timeouts.length).toBeGreaterThan(0)
		expect(Math.min(...timeouts)).toBeGreaterThanOrEqual(wiring.minimum_timeout_seconds)
	})

	// The settings file names the subcommand as a string, so a rename on the josh side would leave a
	// hook that fails on every call with nothing pointing at the cause. Read from the `pnpm josh`
	// fallback the launch form still carries (joshuafolkken/kit#2023), which names the same subcommand
	// the bundle runs; a plain `pnpm josh <cmd>` hook matches the same pattern.
	it('names a subcommand josh actually has', () => {
		const subcommand = /pnpm josh ([\w:-]+)/u.exec(wiring.command)?.[1] ?? ''

		expect(Object.keys(COMMAND_MAP)).toContain(subcommand)
	})
}

// The five properties every tool hook in this file has to hold, written once. The second hook
// (joshuafolkken/kit#1390) is what turned a single block into a duplicate of it, which is the moment
// `CLAUDE.md` → "No clones" says to single-source rather than to copy.
function describe_tool_hook(title: string, wiring: ToolHookWiring): void {
	describe(title, () => {
		describe_shared_hook_properties(wiring)

		// The exact set rather than each member: what a hook does *not* name is load-bearing too, and an
		// inclusion test would pass a guard that had quietly grown the two edit tools back.
		it('names exactly the tools it is meant to cover', () => {
			expect([...tools_of(wiring)].toSorted(by_name)).toEqual([...wiring.tools].toSorted(by_name))
		})

		// Claude Code reads a matcher built only from letters, digits, `_`, `-`, spaces, `,` and `|` as
		// an exact list of tool names, and anything else as an unanchored regular expression. That
		// difference decides a real case, because `Bash` is a prefix of `BashOutput`: read as a regex the
		// list form catches that tool too — a few spare starts and nothing worse — while an anchored
		// `^(Edit|Write|Bash)$` read as a *list* names no existing tool at all and the hook silently
		// stops running. This pins the form whose failure is the bounded one.
		it('names its tools as an exact list rather than a regular expression', () => {
			const matchers = matchers_of(wiring).map((entry) => entry.matcher)

			expect(matchers.length).toBeGreaterThan(0)

			for (const matcher of matchers) expect(matcher).toMatch(/^[\w\-, |]+$/u)
		})
	})
}

// `SessionStart` carries no tool matcher, so the two assertions above have nothing to check here.
// What replaces them is the matcher's emptiness: Claude Code reads a `SessionStart` matcher as the
// *reason* the session began — `startup`, `resume`, `clear`, `compact` — and naming one of them would
// leave the other three starting a session whose audit tooling was never provisioned.
function describe_session_hook(title: string, wiring: HookWiring): void {
	describe(title, () => {
		describe_shared_hook_properties(wiring)

		it('matches every session start rather than one start reason', () => {
			expect(matchers_of(wiring).map((entry) => entry.matcher)).toEqual([''])
		})
	})
}

describe_session_hook('.claude/settings.json — session-start audit provisioning', {
	event: 'SessionStart',
	command: PROVISION_HOOK_COMMAND,
	minimum_timeout_seconds: MINIMUM_PROVISION_TIMEOUT_SECONDS,
})

// `UserPromptSubmit` carries no tool matcher, so it shares the session hook's three checks and the
// empty-matcher assertion. The language hook rides this event alone since joshuafolkken/kit#1930 —
// wired beside the work-summary echoes — because running it on SessionStart too resolved it twice on
// the first turn.
describe('.claude/settings.json — per-turn language resolution', () => {
	const wiring: HookWiring = {
		event: 'UserPromptSubmit',
		command: SESSION_LANG_HOOK_COMMAND,
		minimum_timeout_seconds: MINIMUM_SESSION_LANG_TIMEOUT_SECONDS,
	}

	describe_shared_hook_properties(wiring)

	it('matches every prompt rather than one matcher variant', () => {
		expect(matchers_of(wiring).map((entry) => entry.matcher)).toEqual([''])
	})
})

describe_tool_hook('.claude/settings.json — post-edit formatting hook', {
	event: 'PostToolUse',
	command: FORMAT_HOOK_COMMAND,
	tools: FORMAT_TOOLS,
	minimum_timeout_seconds: MINIMUM_HOOK_TIMEOUT_SECONDS,
})

describe_tool_hook('.claude/settings.json — consolidated pre-call guard', {
	event: 'PreToolUse',
	command: PRETOOL_GUARD_HOOK_COMMAND,
	tools: PRETOOL_GUARD_TOOLS,
	minimum_timeout_seconds: MINIMUM_GUARD_TIMEOUT_SECONDS,
})

// The consolidation's own guarantee (joshuafolkken/kit#1930): PreToolUse is one entry running one
// hook, so the three-launch cost is gone rather than merely relabelled.
function pretool_entries(): ReadonlyArray<HookMatcher> {
	return claude_settings_fixture.load_settings().hooks.PreToolUse ?? []
}

describe('.claude/settings.json — PreToolUse is one consolidated entry', () => {
	it('declares exactly one matcher entry', () => {
		expect(pretool_entries()).toHaveLength(1)
	})

	it('runs exactly one hook, the consolidated guard', () => {
		const commands = pretool_entries()
			.flatMap((entry) => entry.hooks)
			.map((handler) => handler.command)

		expect(commands).toEqual([PRETOOL_GUARD_HOOK_COMMAND])
	})
})

function all_hooks(): ReadonlyArray<HookHandler> {
	const { hooks } = claude_settings_fixture.load_settings()
	const events = [hooks.SessionStart, hooks.UserPromptSubmit, hooks.PreToolUse, hooks.PostToolUse]

	return events.flatMap((matchers) => matchers ?? []).flatMap((entry) => entry.hooks)
}

// joshuafolkken/kit#1930: the language hook fired on both SessionStart and UserPromptSubmit, so the
// first turn resolved it twice. It rides UserPromptSubmit alone now — every turn, the first included.
describe('.claude/settings.json — the language hook is not duplicated', () => {
	it('runs session:lang exactly once across every event', () => {
		const count = all_hooks().filter(
			(handler) => handler.command === SESSION_LANG_HOOK_COMMAND,
		).length

		expect(count).toBe(1)
	})

	it('does not run session:lang on SessionStart', () => {
		const starts = (claude_settings_fixture.load_settings().hooks.SessionStart ?? []).flatMap(
			(entry) => entry.hooks,
		)

		expect(starts.map((handler) => handler.command)).not.toContain(SESSION_LANG_HOOK_COMMAND)
	})
})

// joshuafolkken/kit#1930: an echo hook is injected on every prompt, so each is kept short.
function echo_commands(): ReadonlyArray<string> {
	return (claude_settings_fixture.load_settings().hooks.UserPromptSubmit ?? [])
		.flatMap((entry) => entry.hooks)
		.map((handler) => handler.command)
		.filter((command) => command.startsWith('echo '))
}

describe('.claude/settings.json — the per-turn echoes are short', () => {
	it('injects at least one reminder echo', () => {
		expect(echo_commands().length).toBeGreaterThan(0)
	})

	it('keeps every echo under the per-turn length budget', () => {
		for (const command of echo_commands()) expect(command.length).toBeLessThan(ECHO_MAX_LENGTH)
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
