import { statSync } from 'node:fs'
import path from 'node:path'
import { code_quality_rules } from '#eslint/rules/code-quality.js'
import { stamp_file } from '#scripts/josh/stamp-file'
import { find_local_bin_upwards } from '#scripts/local-bin'
import { execa } from 'execa'
import { z } from 'zod'

// joshuafolkken/kit#1425: the file line limit was only ever reported *after* the writing was done.
// Measured by hand from run #1406's transcript (PR #1422, 45.8 minutes), 19.8% of the whole run —
// 543 seconds — went on reacting to `max-lines` once the implementation was already finished:
// `pnpm josh gate` five times and `pnpm josh lint` four, of which 115 seconds was tool execution and
// the remaining 353 was model time in between. The splitting itself was correct work; what was wrong
// is that it was decided after the fact rather than at design time.
//
// **The limit is not changed here, and nothing in this file counts lines its own way.** That is the
// trap a headroom report walks into: a second counting method becomes a way to satisfy the limit by
// counting differently, and `CLAUDE.md` treats reinterpreting a verification gate as a prohibited
// workaround. So the number is not computed — it is *asked of the project's own eslint*, the same
// invocation `pnpm josh lint` reaches, with `max-lines` lowered to 0 so the rule reports
// unconditionally and its message carries the count it would have compared against the real limit.
//
// **Running ESLint in process instead was tried first and is wrong.** `new Linter().verify(...)` and
// `new ESLint().lintFiles(...)` both answer **one line lower than the `eslint` CLI on any file that
// starts with `#!`** — measured on eslint 10.10.0 with this repository's own config, `301` from the
// CLI against `300` from either API for the same file. Every `scripts/*.ts` entry point has a
// hashbang, so an in-process count would have been quietly wrong for most of this package while the
// gate went on failing at a number the report never showed. Spawning costs a process; agreeing with
// the gate is the whole point of the report.

const MAX_LINES_RULE = 'max-lines'
// The rule reports when the count is **greater than** `max`, and 0 is the lowest value its own schema
// accepts — so at `max: 0` every file reports except one whose counted code lines are exactly 0. That
// is not only the empty file: with `skipBlankLines` and `skipComments` on, a comments-and-blank-lines
// module counts 0 too. `count_or_zero` below is what keeps that case an answer rather than a shrug —
// and `--no-inline-config` is what keeps a silenced rule from being mistaken for one of those files.
const PROBE_MAX = 0
const PROBE_SEVERITY = 'error'
// The boundary between having headroom and being over the limit. Deliberately *not* `PROBE_MAX`, which
// they happen to share the value of today: one is the value handed to the rule and the other is a
// property of a budget, and reading the two as one constant means raising either silently moves the
// other.
const NO_HEADROOM = 0
// A file eslint linted but said nothing about under this rule has exactly this many code lines.
const NO_CODE_LINES = 0
// `File has too many lines (229). Maximum allowed is 0.` — the first parenthesised number is the
// count. Pinned by a test that feeds the number back as the real limit and checks that the gate's own
// verdict flips at exactly that boundary, so a reworded message fails there rather than reporting a
// wrong number quietly.
const COUNT_PATTERN = /\((\d+)\)/u
const COUNT_GROUP = 1

// **Why 85%, and how it lines up with joshuafolkken/kit#1249.** That issue asks for the same shape
// for a distributed document's resident budget and is still open with nothing settled, so there is no
// number there to copy; what it and joshuafolkken/kit#951 settle is the *form* — a margin that turns
// "at the limit" into a warning while there is still room to write the fix. Matching the resident
// reserve's fraction instead (2,000 of 60,000 bytes, 3.3%) would leave 10 lines of margin, less than
// one function is allowed to be, which is a warning arriving with nowhere left to go. 45 lines is a
// little under two functions at the 25-line function limit — enough to write the split into.
const NEAR_LIMIT_FRACTION = 0.85
const PERCENT = 100

const ESLINT_BIN = 'eslint'
const PNPM = 'pnpm'
const PNPM_EXEC = 'exec'
// `--no-inline-config` is not tidiness: a `/* eslint-disable max-lines */` at the top of a file
// silences the rule, an inline directive beats the `--rule` override, and the probe would then see no
// message and read the file as 0 code lines — printing `300 to spare` for a 500-line file, which is
// the most dangerous direction this report can be wrong in. With inline configuration off, the count
// is always the rule's own.
const FORMAT_FLAGS: ReadonlyArray<string> = ['--format', 'json', '--no-inline-config']
const RULE_FLAG = '--rule'
// **No `--cache`, and a `--cache-location` all the same.** An eslint run started *without* `--cache`
// deletes whatever `--cache-location` names, which is how the edit hook once wiped the gate's cache
// (joshuafolkken/kit#1332) — so the flag has to be here, pointed somewhere harmless, even though this
// probe keeps no cache. It keeps none because the only key available is the checkout, and two
// `josh lines` calls at once in one repository — routine with parallel agents here — would then be two
// unsynchronized writers of one file. A cold run is a couple of seconds against the 543 this report
// exists to save, so the cache is not worth a shared-state hazard.
const CACHE_PREFIX = 'josh-lines-eslint-cache-'
const CACHE_LOCATION_FLAG = '--cache-location'
// Bounded so a hung child ends the call rather than holding it open. A cold type-aware lint of a few
// files is seconds; this is two orders of magnitude beyond that.
const PROCESS_TIMEOUT_MS = 180_000

// The rule entry as `eslint/rules/code-quality.js` writes it. Read through a schema rather than an
// assertion: the options are handed straight back to eslint, so a shape that drifted would otherwise
// reach the probe as a silently different rule configuration.
const options_schema = z.looseObject({ max: z.number().int().positive() })
const rule_entry_schema = z.tuple([z.string(), options_schema])

// Only the two fields this reads. `ruleId` is nullable on a parse error or an ignore warning, and
// both of those are answers — "no count for this path" — rather than failures.
const message_schema = z.object({ ruleId: z.string().nullish(), message: z.string() })
const results_schema = z.array(
	z.object({ filePath: z.string(), messages: z.array(message_schema) }),
)

type LineRuleOptions = z.infer<typeof options_schema>

interface LineBudget {
	code_lines: number
	limit: number
	headroom: number
	is_near_limit: boolean
}

interface FileBudget {
	file_path: string
	budget: LineBudget | undefined
}

// The limit and the skip options both come from the rule that enforces them, so there is no second
// definition of either to drift. Lowering `max` is the only change the probe makes.
function max_lines_options(): LineRuleOptions {
	return rule_entry_schema.parse(code_quality_rules[MAX_LINES_RULE])[1]
}

function configured_limit(): number {
	return max_lines_options().max
}

function near_limit_threshold(limit: number = configured_limit()): number {
	return Math.ceil(limit * NEAR_LIMIT_FRACTION)
}

function budget_of(code_lines: number, limit: number = configured_limit()): LineBudget {
	return {
		code_lines,
		limit,
		headroom: limit - code_lines,
		is_near_limit: code_lines >= near_limit_threshold(limit),
	}
}

function probe_rule(): string {
	return JSON.stringify({
		[MAX_LINES_RULE]: [PROBE_SEVERITY, { ...max_lines_options(), max: PROBE_MAX }],
	})
}

function probe_arguments(file_paths: ReadonlyArray<string>, project_root: string): Array<string> {
	return [
		...FORMAT_FLAGS,
		RULE_FLAG,
		probe_rule(),
		CACHE_LOCATION_FLAG,
		stamp_file.stamp_path(CACHE_PREFIX, project_root),
		...file_paths,
	]
}

// The project's own eslint, through its own shim when there is one and `pnpm exec` when there is not
// — the same two routes every other command in this package reaches a local binary by. The lookup
// **walks up** from the given directory, because pnpm does: resolving only the directory the command
// was invoked in would disagree with the very binary it spawns, which is joshuafolkken/kit#934 and the
// reason `local-bin.ts` ships this variant.
function probe_command(project_root: string, probe_args: ReadonlyArray<string>): Array<string> {
	const shim = find_local_bin_upwards(project_root, ESLINT_BIN)

	return shim === undefined ? [PNPM, PNPM_EXEC, ESLINT_BIN, ...probe_args] : [shim, ...probe_args]
}

// `execa` directly rather than through `buffered-process.ts`: that helper merges stderr into stdout
// and forces color, both of which a JSON reader cannot use.
async function run_probe(
	file_paths: ReadonlyArray<string>,
	project_root: string,
): Promise<string | undefined> {
	const [bin, ...command_arguments] = probe_command(
		project_root,
		probe_arguments(file_paths, project_root),
	)

	try {
		const result = await execa(bin ?? PNPM, command_arguments, {
			cwd: project_root,
			reject: false,
			stdout: 'pipe',
			stderr: 'ignore',
			timeout: PROCESS_TIMEOUT_MS,
		})

		return result.stdout
	} catch {
		return undefined
	}
}

function count_in_message(message: string): number | undefined {
	const raw = COUNT_PATTERN.exec(message)?.[COUNT_GROUP]

	return raw === undefined ? undefined : Number(raw)
}

function count_in(messages: ReadonlyArray<z.infer<typeof message_schema>>): number | undefined {
	const reported = messages.find((message) => message.ruleId === MAX_LINES_RULE)

	return reported === undefined ? undefined : count_in_message(reported.message)
}

// **No `max-lines` message is two different answers, and they must not be merged.** A file eslint
// refused — ignored, covered by no configuration, unparseable — carries a message with no `ruleId`,
// and that one has no count. A file eslint linted and this rule did not fire on has exactly 0 code
// lines, which is a number and is reported as one.
function count_or_zero(
	messages: ReadonlyArray<z.infer<typeof message_schema>>,
): number | undefined {
	const counted = count_in(messages)

	if (counted !== undefined) return counted

	const is_refused = messages.some((message) => message.ruleId === null)

	return is_refused ? undefined : NO_CODE_LINES
}

// Keyed by the absolute path eslint reports, so the caller's spelling of a path does not have to
// match it. A path eslint refused is simply absent, and the caller reports that rather than a number.
function counts_in(raw_output: string | undefined): ReadonlyMap<string, number> {
	const counts = new Map<string, number>()
	const parsed = results_schema.safeParse(JSON.parse(raw_output ?? 'null'))

	if (!parsed.success) return counts

	for (const result of parsed.data) {
		const code_lines = count_or_zero(result.messages)

		if (code_lines !== undefined) counts.set(path.resolve(result.filePath), code_lines)
	}

	return counts
}

// The safe entry point, and the only one exported: eslint's output can be empty or truncated, and
// `JSON.parse` throws on both.
function parse_counts(raw_output: string | undefined): ReadonlyMap<string, number> {
	try {
		return counts_in(raw_output)
	} catch {
		return new Map<string, number>()
	}
}

// **Only regular files are passed to eslint, and this is not tidiness.** One argument eslint cannot
// match — a path that is gone, or a directory whose every entry is ignored — makes it exit with no
// JSON at all, and because this sends every path in one run to keep the cost at one process start,
// that single bad argument would leave every *other* path unanswered.
// `throwIfNoEntry: false` covers a path that is not there and nothing else — an unreadable parent
// directory raises `EACCES`, which would leave this call with no answer at all rather than one bad
// row, taking every other path in the same invocation with it.
function is_lintable_path(file_path: string): boolean {
	try {
		return statSync(file_path, { throwIfNoEntry: false })?.isFile() === true
	} catch {
		return false
	}
}

function lintable_paths(file_paths: ReadonlyArray<string>): ReadonlyArray<string> {
	return file_paths.filter((file_path) => is_lintable_path(file_path))
}

// One eslint run for every path asked about, rather than one per path. The cost of this report is a
// process start, so the number of paths is the one thing that must not multiply it.
async function budgets_for(
	file_paths: ReadonlyArray<string>,
	project_root: string,
): Promise<ReadonlyArray<FileBudget>> {
	const present = lintable_paths(file_paths)
	const raw_output = present.length === 0 ? undefined : await run_probe(present, project_root)
	const counts = parse_counts(raw_output)
	const limit = configured_limit()

	return file_paths.map((file_path) => {
		const code_lines = counts.get(path.resolve(file_path))

		return {
			file_path,
			budget: code_lines === undefined ? undefined : budget_of(code_lines, limit),
		}
	})
}

// `268/300 code lines (89%), 32 to spare` — the one phrasing every reader of this budget prints, so
// two of them can never describe the same file differently.
// The share is floored rather than rounded, so it cannot print a number the advice disagrees with:
// rounded, 254/300 reads `85%` while `near_limit_threshold` is 255 and no advice follows it — and the
// documentation tells the reader that 85% is where "near the limit" begins.
function describe(budget: LineBudget): string {
	const share = Math.floor((budget.code_lines / budget.limit) * PERCENT)
	const remaining =
		budget.headroom < NO_HEADROOM
			? `${String(-budget.headroom)} over`
			: `${String(budget.headroom)} to spare`
	const counted = `${String(budget.code_lines)}/${String(budget.limit)}`

	return `${counted} code lines (${String(share)}%), ${remaining}`
}

// What to do about it, and nothing when there is nothing to do. Over the limit the gate will report
// it anyway; near it, the decision is the one Step 0 is supposed to make before the writing starts.
function advice(budget: LineBudget): string | undefined {
	if (budget.headroom < NO_HEADROOM) return 'over the limit: split it before the gate reports it'
	if (!budget.is_near_limit) return undefined

	return 'near the limit: declare the splitting plan in Step 0 before writing into it'
}

const line_budget = {
	advice,
	budget_of,
	budgets_for,
	configured_limit,
	describe,
	is_lintable_path,
	near_limit_threshold,
	parse_counts,
	probe_arguments,
	probe_command,
	probe_rule,
	NEAR_LIMIT_FRACTION,
}

export { line_budget }
export type { FileBudget, LineBudget }
