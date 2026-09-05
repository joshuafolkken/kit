import { gate_plan } from '#scripts/gate-plan'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'

// What a command line actually checks, read from the command itself (joshuafolkken/kit#1313).
//
// The layer readers beside this file say *where* a command runs; this one says *what it is*, so the
// two can be crossed to find a check that runs in more than one layer. Nothing here knows about
// layers, and nothing here records today's answer: the tables below are about tools and about
// `josh` sub-commands, both of which outlive any particular hook configuration.
//
// **`josh gate` expands through `gate-plan.ts`, not through a copy of its check list.** That module
// is the gate's own declaration of what it runs, so a fifth check added there is picked up here the
// same day rather than the day someone remembers this file.

const PRETTIER = 'prettier'
const ESLINT = 'eslint'
const UNIT_TESTS = 'unit-tests'
const SECRET_SCAN = 'secret-scan'
const DEPENDENCY_AUDIT = 'dependency-audit'

// One tool, and the substrings that name it on a command line, matched case-insensitively against
// the whole command.
//
// **`patterns` is alternatives of requirements: the outer list is OR, each inner list is AND.** One
// contiguous substring is not enough, because the distinguishing form is usually two words that need
// not be adjacent: `tsc --noEmit` is a type check, and so is `tsc --project tsconfig.json --noEmit`,
// which a `'tsc --noemit'` substring silently misses — and a miss here is invisible, since such a
// command resolves without naming any `josh` target and so contributes no unresolved name either.
interface ToolSignature {
	id: string
	patterns: ReadonlyArray<ReadonlyArray<string>>
}

// **`playwright` *and* `test` rather than `playwright` alone**: CI installs browsers with
// `playwright install`, and matching the bare binary would report the download step as a second
// E2E run.
const TOOL_SIGNATURES: ReadonlyArray<ToolSignature> = [
	{ id: PRETTIER, patterns: [[PRETTIER]] },
	{ id: ESLINT, patterns: [[ESLINT]] },
	{ id: 'type-check', patterns: [['tsc', '--noemit']] },
	{ id: 'cspell', patterns: [['cspell']] },
	{ id: UNIT_TESTS, patterns: [['vitest']] },
	{ id: 'e2e-tests', patterns: [['test:e2e'], ['playwright test']] },
	{ id: SECRET_SCAN, patterns: [['secretlint']] },
	{ id: DEPENDENCY_AUDIT, patterns: [['osv-scanner'], ['pnpm audit']] },
	{ id: 'dependency-install', patterns: [['pnpm install']] },
	{ id: 'static-analysis', patterns: [['sonarqube-scan']] },
]

// The `josh` sub-commands whose check cannot be read off their own name. A shell-backed entry is
// resolved through `COMMAND_MAP` instead — `josh check` carries `tsc --noEmit` in its own argv —
// so only the script-backed ones need saying here, and a target in neither place is *reported*
// rather than guessed at.
/* eslint-disable @typescript-eslint/naming-convention */
const JOSH_TOOLS: Record<string, ReadonlyArray<string>> = {
	lint: [PRETTIER, ESLINT],
	'lint:related': [PRETTIER, ESLINT],
	'test:unit': [UNIT_TESTS],
	'test:related': [UNIT_TESTS],
	'pre-push-unit': [UNIT_TESTS],
	audit: [DEPENDENCY_AUDIT],
	'secretlint-scan': [SECRET_SCAN],
	'prevent-main-commit': ['branch-guard'],
	'check-commit-message': ['commit-message'],
	'reconcile-templates': ['template-parity'],
}
/* eslint-enable @typescript-eslint/naming-convention */

const JOSH_TOKEN = 'josh'
const PREVIOUS_TOKEN_OFFSET = 1

// What one command was found to run, plus the `josh` sub-commands that could not be resolved to a
// check. The second half is the staleness guard: a hook rewired to a new `josh` target shows up as
// an unresolved name instead of silently dropping out of the duplication list.
interface CommandChecks {
	checks: ReadonlyArray<string>
	unresolved: ReadonlyArray<string>
}

// What one `josh` target expands to. **A target expands to further command lines, never straight to
// another target** — `josh gate` becomes four `josh <check>` lines, and a shell-backed target
// becomes its own argv.
//
// **The walk recurses once per target rather than once per level.** A target that expanded is
// judged by what its own expansion found, so the walk has to know which target a subtree belongs
// to; a single flattened recursion loses exactly that, which is how a shell-backed target reaching
// no check disappeared without a note (joshuafolkken/kit#1367).
interface Expansion {
	checks: ReadonlyArray<string>
	commands: ReadonlyArray<string>
	unresolved: ReadonlyArray<string>
}

const EMPTY_CHECKS: CommandChecks = { checks: [], unresolved: [] }

function unique_sorted(values: ReadonlyArray<string>): Array<string> {
	return [...new Set(values)].toSorted((left, right) => left.localeCompare(right))
}

function match_signatures(command: string): Array<string> {
	const lowered = command.toLowerCase()

	return TOOL_SIGNATURES.filter((signature) =>
		signature.patterns.some((required) => required.every((part) => lowered.includes(part))),
	).map((signature) => signature.id)
}

// Every token that directly follows a bare `josh`, which covers `josh gate`, `pnpm josh gate` and
// the `sh -c "pnpm josh a && pnpm josh b"` composites alike.
//
// **Expanded through `ALIASES` first**, because a hook may be written with one: `pnpm josh ga` is
// `josh gate`, and without this the whole gate expansion disappears from the tables and the target
// is reported as a name nobody can classify.
function josh_targets(command: string): Array<string> {
	const tokens = command.split(/\s+/u).filter((token) => token.length > 0)

	return tokens
		.filter((_, index) => tokens[index - PREVIOUS_TOKEN_OFFSET] === JOSH_TOKEN)
		.map((token) => ALIASES[token] ?? token)
}

// The command lines a target stands for: the gate's four checks, or a shell-backed entry's own argv.
function target_commands(target: string): ReadonlyArray<string> {
	if (target === GATE_COMMAND) {
		return gate_plan.GATE_CHECKS.map((check) => `${JOSH_TOKEN} ${check.target}`)
	}

	const shell = COMMAND_MAP[target]?.shell

	return shell === undefined ? [] : [shell.join(' ')]
}

function expand_target(target: string): Expansion {
	const declared = JOSH_TOOLS[target]
	if (declared !== undefined) return { checks: declared, commands: [], unresolved: [] }

	const commands = target_commands(target)
	if (commands.length > 0) return { checks: [], commands, unresolved: [] }

	// The target's own name is the last thing tried, and it answers for the sub-commands named after
	// the check they run: `josh test:e2e` is script-backed and not in the table above, but `test:e2e`
	// is a signature. Without this the note would list a name that needs no classifying, beside a
	// table that already carries the check it names.
	const named = match_signatures(target)

	return { checks: named, commands: [], unresolved: named.length > 0 ? [] : [target] }
}

// What one target contributes, once its expansion has been walked. A target answered outright by
// the tables is that answer; one that expanded is whatever the walk below it reached.
//
// **An expansion that reached no check at all reports the target's own name.** That is the same
// staleness guard the declared and named branches already carried, extended to the branch that was
// missing it: a shell-backed target whose argv names nothing recognizable — `josh hook:commit`, the
// whole pre-commit run — contributed zero checks *and* zero names, so a hook or CI step running it
// left the tables with nothing at all to say it had been read (joshuafolkken/kit#1367). Whatever the
// expansion did name is kept beside it, since a deeper unclassifiable name is the more specific
// thing to classify.
function merge_target(target: string, expansion: Expansion, deeper: CommandChecks): CommandChecks {
	if (expansion.commands.length === 0) {
		return { checks: expansion.checks, unresolved: expansion.unresolved }
	}

	if (deeper.checks.length > 0) return deeper

	return { checks: [], unresolved: [target, ...deeper.unresolved] }
}

// One level of the walk: what these command lines name outright, and what each of their `josh`
// targets reaches. Both halves run because they answer for different spellings of the same check —
// `pnpm exec cspell` in a hook and `josh cspell:dot` in the gate — and the union deduplicates where
// they overlap.
//
// **Each target is walked against its own path, not against its siblings'.** `seen` exists to stop
// a cycle, and once the verdict above reads a target's own subtree, a set shared across siblings
// would let one target claim a name the next one needed and report that sibling as unclassifiable
// for it — a false entry in the note, in the one direction this report cannot afford.
function resolve_commands(
	commands: ReadonlyArray<string>,
	seen: ReadonlySet<string>,
): CommandChecks {
	if (commands.length === 0) return EMPTY_CHECKS

	const targets = unique_sorted(
		commands.flatMap((command) => josh_targets(command)).filter((t) => !seen.has(t)),
	)
	const resolved = targets.map((target) => {
		const expansion = expand_target(target)
		const next = new Set([...seen, target])

		return merge_target(target, expansion, resolve_commands(expansion.commands, next))
	})

	return {
		checks: [
			...commands.flatMap((command) => match_signatures(command)),
			...resolved.flatMap((entry) => entry.checks),
		],
		unresolved: resolved.flatMap((entry) => entry.unresolved),
	}
}

function resolve_command(command: string): CommandChecks {
	const found = resolve_commands([command], new Set())

	return { checks: unique_sorted(found.checks), unresolved: unique_sorted(found.unresolved) }
}

const layer_checks = { JOSH_TOOLS, TOOL_SIGNATURES, resolve_command }

export type { CommandChecks }
export { layer_checks }
