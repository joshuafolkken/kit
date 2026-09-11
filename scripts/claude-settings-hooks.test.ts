import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import {
	claude_settings_fixture,
	type HookHandler,
	type HookMatcher,
	type HooksBlock,
} from './claude-settings-fixture'
import { PROCESS_TIMEOUT_MS } from './format-edited-file'
import { security_audit_provision_logic } from './security-audit-provision-logic'

const GITIGNORE_PATH = fileURLToPath(new URL('../.gitignore', import.meta.url))

// #852: the innermost feedback loop is one edited file, and before this hook the only way to see
// what prettier and eslint made of it was a whole-project run. The command has to stay a `josh`
// subcommand: a shell one-liner here would be a second copy of the logic in every consumer.
const FORMAT_HOOK_COMMAND = 'pnpm josh format:edited'
// The batching guard, wired to `PreToolUse` because that is the only event that can still stop a call
// (joshuafolkken/kit#1390). The density line the formatting hook carries rides `PostToolUse`, where
// the round trip has already been spent — three runs measured after it shipped came in unchanged at
// 1.10–1.12 calls per round trip against a 1.50 floor.
const GUARD_HOOK_COMMAND = 'pnpm josh batch:guard'
// The investigation guard, on the same event and for the same reason (joshuafolkken/kit#1460): the
// threshold it enforces was already distributed as prose and as an enumeration row, and run #1441
// asked the question once and then read eight more unedited files without asking again.
const READ_GUARD_HOOK_COMMAND = 'pnpm josh investigation:guard'
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
// The formatter formats the file an edit named, so it needs the two edit tools; `Bash` joined them
// for the density line it also carries (joshuafolkken/kit#1337), which reaches the sessions that edit
// through `sed` — seven of the ten most recent in this checkout, and the ones measured under the floor.
const FORMAT_TOOLS = ['Edit', 'Write', 'Bash']
// The guard names the two edit tools beside `Bash` since joshuafolkken/kit#1762. It named `Bash` alone
// while `is_guarded_call` answered `false` for every write, which made a wider matcher a process that
// could only ever answer "allow"; the predicate was widened first, so the matcher now reaches a
// question that has an answer. It is worth the process start because writes are **70.5% of the
// recoverable round trips** measured over 19 runs — 158 `Edit` of 261 — which `Bash` could not reach
// however large its share of the calls.
const GUARD_TOOLS = ['Bash', 'Edit', 'Write']
// The investigation guard names both, because in this repository the reading is split between them:
// run #1441 issued 5 `Read` calls against 10 `cat`, 16 `sed` and 1 `tail`, so a `Read`-only wiring
// would miss the idiom that carries most of the text. It is safe on `Bash` because it refuses only a
// line that writes nothing — `is_read_only_call`, which is the test the batching guard used to share
// with it and kept under that name when it widened (joshuafolkken/kit#1762).
const READ_GUARD_TOOLS = ['Read', 'Bash']
// The rule guard (joshuafolkken/kit#1524): the one dispatcher for rules whose trigger can be named as
// a tool call, so the next rule to leave `CLAUDE.md` costs a row in `delivered-rules.ts` rather than a
// fourth process in front of every call.
const RULE_GUARD_HOOK_COMMAND = 'pnpm josh rule:guard'
// `Bash` alone, and for a reason of its own rather than the batching guard's: every rule this
// dispatcher carries names its binding moment as a shell call — filing an Issue, reading one, pushing
// — so an `Edit` payload would start a process with no row to match it against.
const RULE_GUARD_TOOLS = ['Bash']
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
	// hook that fails on every call with nothing pointing at the cause.
	it('names a subcommand josh actually has', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(wiring.command.split(' ').at(-1) ?? '')
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

describe_tool_hook('.claude/settings.json — post-edit formatting hook', {
	event: 'PostToolUse',
	command: FORMAT_HOOK_COMMAND,
	tools: FORMAT_TOOLS,
	minimum_timeout_seconds: MINIMUM_HOOK_TIMEOUT_SECONDS,
})

describe_tool_hook('.claude/settings.json — pre-call batching guard', {
	event: 'PreToolUse',
	command: GUARD_HOOK_COMMAND,
	tools: GUARD_TOOLS,
	minimum_timeout_seconds: MINIMUM_GUARD_TIMEOUT_SECONDS,
})

describe_tool_hook('.claude/settings.json — pre-read investigation guard', {
	event: 'PreToolUse',
	command: READ_GUARD_HOOK_COMMAND,
	tools: READ_GUARD_TOOLS,
	minimum_timeout_seconds: MINIMUM_GUARD_TIMEOUT_SECONDS,
})

describe_tool_hook('.claude/settings.json — pre-call rule delivery guard', {
	event: 'PreToolUse',
	command: RULE_GUARD_HOOK_COMMAND,
	tools: RULE_GUARD_TOOLS,
	minimum_timeout_seconds: MINIMUM_GUARD_TIMEOUT_SECONDS,
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
