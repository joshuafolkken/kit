import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import path from 'node:path'
import { find_local_bin_upwards } from '#scripts/build/local-bin'
import { stamp_file } from '#scripts/josh/stamp-file'
import { LINT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { z } from 'zod'
import { effective_limit, type LineRuleOptions } from './effective-limit'

// Reports each file's line headroom before the writing starts, so a split is decided at design time
// rather than after the gate reports `max-lines`.
//
// **The limit is not changed here, and nothing in this file counts lines its own way.** That is the
// trap a headroom report walks into: a second counting method becomes a way to satisfy the limit by
// counting differently, and `CLAUDE.md` treats reinterpreting a verification gate as a prohibited
// workaround. So the number is not computed — it is *asked of the project's own eslint*, the same
// invocation `pnpm josh lint` reaches, with `max-lines` lowered to 0 so the rule reports
// unconditionally and its message carries the count it would have compared against the real limit.
//
// **The count comes from the `eslint` CLI, not the in-process API.** `new Linter().verify(...)` and
// `new ESLint().lintFiles(...)` both answer **one line lower than the CLI on any file that starts with
// `#!`**, and every `scripts/*.ts` entry point has a hashbang. Spawning costs a process; agreeing with
// the gate is the whole point of the report.
//
// **The limit and the counting options come from the same place the count does.**
// `effective-limit.ts` resolves the `max-lines` entry the project's own eslint applies **to each
// file**, so a consumer that overrides `max-lines` after `create_base_config` is held to its own rule.
// Where no entry can be resolved there is no budget, and the count is reported without one: falling
// back to kit's number would report a limit the project does not enforce.

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

// **Why 85%.** The margin turns "at the limit" into a warning while there is still room to write the
// fix: 45 lines of a 300-line limit is a little under two functions at the 25-line function limit —
// enough to write the split into.
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
// deletes whatever `--cache-location` names, which would wipe the gate's cache — so the flag has to be here, pointed somewhere harmless, even though this
// probe keeps no cache. It keeps none because the only key available is the checkout, and two
// `josh lines` calls at once in one repository — routine with parallel agents here — would then be two
// unsynchronized writers of one file. A cold run is a couple of seconds, so the cache is not worth a
// shared-state hazard.
//
// **The path is per probe, not per call.** Since the counting method decides how many probes one call
// starts, two of them can run concurrently — and each deletes whatever
// `--cache-location` names as it starts, so one shared path would have them racing to unlink the file
// the other just made. The option set's own key is folded into the name, which makes the paths
// distinct exactly when the probes are.
const CACHE_PREFIX = 'josh-lines-eslint-cache-'
const CACHE_LOCATION_FLAG = '--cache-location'
const CACHE_KEY_LENGTH = 8

// Only the two fields this reads. `ruleId` is nullable on a parse error or an ignore warning, and
// both of those are answers — "no count for this path" — rather than failures.
const message_schema = z.object({ ruleId: z.string().nullish(), message: z.string() })
const result_schema = z.object({ filePath: z.string(), messages: z.array(message_schema) })
const results_schema = z.array(result_schema)

type LintResult = z.infer<typeof result_schema>

// The rule entry the probe hands eslint — as `--rule` JSON to the CLI, as `overrideConfig` rules to
// the Node API.
type ProbeRules = Record<string, [typeof PROBE_SEVERITY, LineRuleOptions & { max: number }]>

interface LineBudget {
	code_lines: number
	limit: number
	headroom: number
	is_near_limit: boolean
}

// `limit` is carried beside the budget, and it is not the same thing as `budget.limit`: a path this
// project enforces no `max-lines` on has no limit at all, and the caller has to be able to say that
// rather than say the count failed.
interface FileBudget {
	file_path: string
	limit: number | undefined
	budget: LineBudget | undefined
}

// The paths that share one counting method, and therefore one eslint run. `key` identifies that
// method — it is what the paths were grouped by, and what keeps two concurrent probes off one cache
// path.
interface ProbeGroup {
	key: string
	options: LineRuleOptions
	paths: Array<string>
}

function near_limit_threshold(limit: number): number {
	return Math.ceil(limit * NEAR_LIMIT_FRACTION)
}

// The share of the limit at which "near the limit" begins, for a report that has no single limit to
// state the boundary as a line count against.
function near_limit_percent(): number {
	return Math.round(NEAR_LIMIT_FRACTION * PERCENT)
}

function budget_of(code_lines: number, limit: number): LineBudget {
	return {
		code_lines,
		limit,
		headroom: limit - code_lines,
		is_near_limit: code_lines >= near_limit_threshold(limit),
	}
}

// The counting options are the project's own, so a consumer that turns `skipComments` off is counted
// its way. Lowering `max` is the only change the probe makes.
function probe_rules(options: LineRuleOptions): ProbeRules {
	return { [MAX_LINES_RULE]: [PROBE_SEVERITY, { ...options, max: PROBE_MAX }] }
}

function probe_rule(options: LineRuleOptions): string {
	return JSON.stringify(probe_rules(options))
}

function cache_prefix(key: string): string {
	const digest = createHash('sha256').update(key).digest('hex').slice(0, CACHE_KEY_LENGTH)

	return `${CACHE_PREFIX}${digest}-`
}

function probe_arguments(group: ProbeGroup, project_root: string): Array<string> {
	return [
		...FORMAT_FLAGS,
		RULE_FLAG,
		probe_rule(group.options),
		CACHE_LOCATION_FLAG,
		stamp_file.stamp_path(cache_prefix(group.key), project_root),
		...group.paths,
	]
}

// The project's own eslint, through its own shim when there is one and `pnpm exec` when there is not
// — the same two routes every other command in this package reaches a local binary by. The lookup
// **walks up** from the given directory, because pnpm does: resolving only the directory the command
// was invoked in would disagree with the very binary it spawns.
function probe_command(project_root: string, probe_args: ReadonlyArray<string>): Array<string> {
	const shim = find_local_bin_upwards(project_root, ESLINT_BIN)

	return shim === undefined ? [PNPM, PNPM_EXEC, ESLINT_BIN, ...probe_args] : [shim, ...probe_args]
}

// `execa` directly rather than through `buffered-process.ts`: that helper merges stderr into stdout
// and forces color, both of which a JSON reader cannot use.
async function run_probe(group: ProbeGroup, project_root: string): Promise<string | undefined> {
	const [bin, ...command_arguments] = probe_command(
		project_root,
		probe_arguments(group, project_root),
	)

	try {
		const result = await execa(bin ?? PNPM, command_arguments, {
			cwd: project_root,
			reject: false,
			stdout: 'pipe',
			stderr: 'ignore',
			timeout: LINT_TIMEOUT_MS,
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
// The results are eslint's own objects whether they arrived as the CLI's JSON or from the Node API,
// so `josh metrics` reads its in-process run through this same reading.
function counts_from(results: ReadonlyArray<LintResult>): ReadonlyMap<string, number> {
	const counts = new Map<string, number>()

	for (const result of results) {
		const code_lines = count_or_zero(result.messages)

		if (code_lines !== undefined) counts.set(path.resolve(result.filePath), code_lines)
	}

	return counts
}

function counts_in(raw_output: string | undefined = 'null'): ReadonlyMap<string, number> {
	const parsed = results_schema.safeParse(JSON.parse(raw_output))

	return parsed.success ? counts_from(parsed.data) : new Map<string, number>()
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

// One eslint run per *distinct counting method*, rather than one per path. The cost of this report is
// a process start, so the number of paths is the one thing that must not multiply it — and the number
// of distinct `max-lines` option sets in one project is one, in every configuration that does not
// deliberately count two groups of files differently.
// The keys are sorted before they are written out, so two config blocks that state the same options in
// a different order are one group rather than two. Unsorted, a purely cosmetic difference would split
// the probe in two and cost a second eslint process for nothing.
function options_key(options: LineRuleOptions): string {
	return JSON.stringify(
		options,
		Object.keys(options).toSorted((left, right) => left.localeCompare(right)),
	)
}

function grouped(
	options_by_path: ReadonlyMap<string, LineRuleOptions>,
): ReadonlyMap<string, ProbeGroup> {
	const groups = new Map<string, ProbeGroup>()

	for (const [file_path, options] of options_by_path) {
		const key = options_key(options)
		const group = groups.get(key) ?? { key, options, paths: [] }

		group.paths.push(file_path)
		groups.set(key, group)
	}

	return groups
}

async function counts_for(
	options_by_path: ReadonlyMap<string, LineRuleOptions>,
	project_root: string,
): Promise<ReadonlyMap<string, number>> {
	const groups: Array<ProbeGroup> = []

	for (const [, group] of grouped(options_by_path)) groups.push(group)

	const outputs = await Promise.all(
		groups.map(async (group) => await run_probe(group, project_root)),
	)
	const counts = new Map<string, number>()

	for (const output of outputs) {
		for (const [file_path, code_lines] of parse_counts(output)) counts.set(file_path, code_lines)
	}

	return counts
}

function budget_for(
	code_lines: number | undefined,
	limit: number | undefined,
): LineBudget | undefined {
	if (code_lines === undefined || limit === undefined) return undefined

	return budget_of(code_lines, limit)
}

// A path is counted only where its limit is known, because a count with nothing to compare it against
// is reported as a bare number rather than as a budget — so probing it would buy nothing.
async function budgets_for(
	file_paths: ReadonlyArray<string>,
	project_root: string,
): Promise<ReadonlyArray<FileBudget>> {
	const options = await effective_limit.options_for(lintable_paths(file_paths), project_root)
	const counts = await counts_for(options, project_root)

	return file_paths.map((file_path) => {
		const resolved = path.resolve(file_path)
		const code_lines = counts.get(resolved)
		const limit = options.get(resolved)?.max

		return { file_path, limit, budget: budget_for(code_lines, limit) }
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
	counts_from,
	describe,
	grouped,
	is_lintable_path,
	near_limit_percent,
	near_limit_threshold,
	parse_counts,
	probe_arguments,
	probe_command,
	probe_rule,
	probe_rules,
	NEAR_LIMIT_FRACTION,
}

export { line_budget }
export type { FileBudget, LineBudget }
