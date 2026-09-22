import path from 'node:path'
import { find_local_bin_upwards } from '#scripts/build/local-bin'
import { execa } from 'execa'
import { z } from 'zod'

// The mechanical half of `prompts/refactoring.md` (joshuafolkken/kit#2255): the refactoring
// priorities ESLint already decides. Rather than read the checklist and grep by hand, the project's
// own eslint is asked in JSON and its findings are bucketed into the checklist's items.
//
// **The count is the gate's own, not a second one.** As in `line-budget.ts`, the project's eslint is
// spawned — its findings, its rule severities — so this can never disagree with `pnpm josh gate`
// about what is there. `local/namespace-object-export` is now among the rules queried — the rule
// exists, so the oracle reads it like any other rather than deferring it to the gate. Only the two
// priorities with no rule stay prose (side-effect idempotency and "similar UI structure"), and
// `refactor-scan-prompt-sync.test.ts` fails if this list and the prompt drift apart.

const ESLINT_BIN = 'eslint'
const PNPM = 'pnpm'
const PNPM_EXEC = 'exec'
// `--no-inline-config` so a `/* eslint-disable */` in a file cannot hide a candidate from the scan the
// way it can from the gate; the scan reports what the rules say, not what a file asked to suppress.
const FORMAT_FLAGS: ReadonlyArray<string> = ['--format', 'json', '--no-inline-config']
const PROCESS_TIMEOUT_MS = 180_000

type Priority = 'high' | 'medium' | 'low'
const HIGH: Priority = 'high'
const MEDIUM: Priority = 'medium'
const LOW: Priority = 'low'

interface RefactorCategory {
	key: string
	label: string
	priority: Priority
	rules: ReadonlyArray<string>
}

// The refactoring priorities ESLint decides, each with the rules that populate it — the high- and
// medium-priority convergence items plus the one low-priority item (unused code), which is reported
// but never counted toward convergence. `refactor-scan-prompt-sync.test.ts` pins this list against
// the prompt, so a rule added here without the prompt (or the reverse) fails.
const CATEGORIES: ReadonlyArray<RefactorCategory> = [
	{
		key: 'lines-complexity',
		label: 'lines & complexity',
		priority: HIGH,
		rules: ['max-lines', 'max-lines-per-function', 'complexity', 'sonarjs/cognitive-complexity'],
	},
	{
		key: 'type-safety',
		label: 'type safety',
		priority: HIGH,
		rules: ['@typescript-eslint/no-explicit-any'],
	},
	{
		key: 'namespace-export',
		label: 'namespace-object export',
		priority: HIGH,
		rules: ['local/namespace-object-export'],
	},
	{
		key: 'duplicate-code',
		label: 'duplicate code',
		priority: HIGH,
		rules: ['sonarjs/no-identical-functions'],
	},
	{
		key: 'duplicate-string',
		label: 'duplicate string',
		priority: MEDIUM,
		rules: ['sonarjs/no-duplicate-string'],
	},
	{
		key: 'magic-number',
		label: 'magic number',
		priority: MEDIUM,
		rules: ['@typescript-eslint/no-magic-numbers'],
	},
	{
		key: 'naming-convention',
		label: 'variable naming',
		priority: MEDIUM,
		rules: ['@typescript-eslint/naming-convention'],
	},
	{
		key: 'unused-code',
		label: 'unused code',
		priority: LOW,
		rules: ['@typescript-eslint/no-unused-vars'],
	},
]

const message_schema = z.object({
	ruleId: z.string().nullish(),
	line: z.number().nullish(),
})
const results_schema = z.array(
	z.object({ filePath: z.string(), messages: z.array(message_schema) }),
)
type LintResult = z.infer<typeof results_schema>[number]

interface Candidate {
	location: string
	rule: string
}

interface CategoryResult {
	key: string
	label: string
	priority: Priority
	candidates: ReadonlyArray<Candidate>
}

// Rule id → the category it belongs to, built once so `categorize` is a lookup rather than a scan of
// every category per message.
function rule_index(): ReadonlyMap<string, RefactorCategory> {
	const index = new Map<string, RefactorCategory>()

	for (const category of CATEGORIES) for (const rule of category.rules) index.set(rule, category)

	return index
}

const RULE_INDEX = rule_index()

type Message = z.infer<typeof message_schema>

function message_category(rule_id: string | null | undefined): RefactorCategory | undefined {
	return rule_id === null || rule_id === undefined ? undefined : RULE_INDEX.get(rule_id)
}

function candidate_of(message: Message, root: string, file_path: string): Candidate {
	const location = `${path.relative(root, file_path)}:${String(message.line ?? 0)}`

	return { location, rule: message.ruleId ?? '' }
}

function collect_message(
	message: Message,
	root: string,
	file_path: string,
	buckets: Map<string, Array<Candidate>>,
): void {
	const category = message_category(message.ruleId)

	if (category === undefined) return

	buckets.get(category.key)?.push(candidate_of(message, root, file_path))
}

function candidates_by_category(
	results: LintResult,
	root: string,
	buckets: Map<string, Array<Candidate>>,
): void {
	for (const message of results.messages) collect_message(message, root, results.filePath, buckets)
}

function empty_buckets(): Map<string, Array<Candidate>> {
	const buckets = new Map<string, Array<Candidate>>()

	for (const category of CATEGORIES) buckets.set(category.key, [])

	return buckets
}

// The categories with their candidates, in the fixed order above so the report reads the same every
// run. A category with no findings is kept, printed as zero rather than dropped.
function categorize(results: Array<LintResult>, root: string): ReadonlyArray<CategoryResult> {
	const buckets = empty_buckets()

	for (const result of results) candidates_by_category(result, root, buckets)

	return CATEGORIES.map((category) => ({
		key: category.key,
		label: category.label,
		priority: category.priority,
		candidates: buckets.get(category.key) ?? [],
	}))
}

function eslint_command(root: string, files: ReadonlyArray<string>): ReadonlyArray<string> {
	const shim = find_local_bin_upwards(root, ESLINT_BIN)
	const args = [...FORMAT_FLAGS, ...files]

	return shim === undefined ? [PNPM, PNPM_EXEC, ESLINT_BIN, ...args] : [shim, ...args]
}

// `undefined` means the run did not produce parseable eslint JSON — a failure, kept distinct from a
// valid empty array (a clean scope), so a scan that could not run is never reported as `clear`
// (joshuafolkken/kit#2180).
function parse_results(raw: string | undefined): Array<LintResult> | undefined {
	try {
		const parsed = results_schema.safeParse(JSON.parse(raw ?? 'null'))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// The project's own eslint over the scope, in JSON. `reject: false` because eslint exits non-zero when
// it finds anything — which it will — and the JSON is on stdout regardless. An empty file list is a
// clean answer (`[]`); a spawn error or unparseable output is a failure (`undefined`), so the caller
// can tell "no candidates" from "the scan did not run".
async function run_eslint_json(
	files: ReadonlyArray<string>,
	root: string,
): Promise<Array<LintResult> | undefined> {
	if (files.length === 0) return []

	const [bin, ...command_arguments] = eslint_command(root, files)

	try {
		const result = await execa(bin ?? PNPM, command_arguments, {
			cwd: root,
			reject: false,
			stdout: 'pipe',
			stderr: 'ignore',
			timeout: PROCESS_TIMEOUT_MS,
		})

		return parse_results(result.stdout)
	} catch {
		return undefined
	}
}

// The categories, or `undefined` when the eslint run failed — the failure is propagated rather than
// flattened to an empty (and therefore `clear`) result.
async function scan_categories(
	files: ReadonlyArray<string>,
	root: string,
): Promise<ReadonlyArray<CategoryResult> | undefined> {
	const results = await run_eslint_json(files, root)

	return results === undefined ? undefined : categorize(results, root)
}

const refactor_lint = {
	categorize,
	parse_results,
	scan_categories,
	CATEGORIES,
	HIGH,
	MEDIUM,
	LOW,
}

export type { CategoryResult, Priority }
export { refactor_lint }
