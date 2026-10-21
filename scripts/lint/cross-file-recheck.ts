import { FAIL_EXIT_CODE, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import type { ESLint } from 'eslint'

// Some rules read other files, and the lint cache keys a verdict on the linted file's own content.
// So once the other file is fixed, the untouched one keeps its cached error until its own content
// changes. `import/no-cycle` did it first (joshuafolkken/kit#3641): a cycle closed by editing one
// side stayed reported on the other. The type-aware rules do it too (joshuafolkken/kit#3667): a call
// to a function its module did not export yet stays `no-unsafe-call` after the export is added.
//
// A red lint run therefore re-reads its cached report: the files reported for a rule that reads
// other files are linted once more without the cache, and their fresh results replace the cached
// ones. A green run never reaches this, so the green path costs what it did.
//
// Which rules those are is the rule's own statement, never a list kept here: a type-aware rule
// declares `requiresTypeChecking`, and the `import` plugin's rules resolve the modules they name.
// That plugin answers to two names: the base config registers it as `import`, and its own preset —
// whose rules a hand-authored `.js` file keeps — as `import-x`.
//
// Only a stale red is re-read. A stale green — the other file broke, the untouched one still
// answers clean — is not something a report can point at; the entry is dropped before the run
// instead, once the files its imports reach no longer hash as recorded
// (`eslint-cache-dependencies.ts`, joshuafolkken/kit#4415).
//
// That holds for a run narrowed to one change's files as much as for the whole tree: the change can
// hold both files, and the one a later edit leaves alone keeps its cached report.
//
// The cached run is asked again through the Node API rather than read off the first run's report:
// that report is the stylish text, and taking a file out of it means re-deriving its problem
// counts. The second asking is answered from the cache the first one just wrote.
const IMPORT_RULE_PATTERN = /^import(?:-x)?\//u
const FORMATTER = 'stylish'
const UNCACHED_SUFFIX = '.uncached'

type RulesMeta = ESLint.LintResultData['rulesMeta']

type LintResults = Array<ESLint.LintResult>

interface Linters {
	cached: ESLint
	fresh: ESLint
	error_results: (results: LintResults) => LintResults
}

interface CrossFileRecheckOptions {
	cache_file: string
	// What the run linted — the whole tree, or one change's files — so the cached run is asked the
	// question it was asked the first time.
	patterns: ReadonlyArray<string>
	// A `--quiet` run prints its error results only, so the re-read report keeps those alone.
	errors_only?: boolean
	// What the fixture test varies: the directory linted and the configuration it is linted with.
	eslint_options?: ESLint.Options
}

// The exit code is eslint's "finished and reported problems", not any failure: a run that could not
// finish — a configuration that does not load, a rule that threw — exits 2, and asking it again
// throws the same error here, ahead of both buffered reports.
function is_red(result: BufferedProcessResult): boolean {
	return result.exit_code === FAIL_EXIT_CODE
}

// `requiresTypeChecking` is typescript-eslint's convention, which other type-aware plugins follow;
// eslint's own type for a rule's docs does not name it.
function is_type_aware(documentation: object | undefined): boolean {
	if (documentation === undefined) return false

	return 'requiresTypeChecking' in documentation && documentation.requiresTypeChecking === true
}

// A problem with no rule is the parser's, about the file itself.
function reads_other_files(rule_id: string | null, rules_meta: RulesMeta): boolean {
	if (rule_id === null) return false

	return IMPORT_RULE_PATTERN.test(rule_id) || is_type_aware(rules_meta[rule_id]?.docs)
}

function suspects_of(linter: ESLint, cached: Array<ESLint.LintResult>): Array<string> {
	const rules_meta = linter.getRulesMetaForResults(cached)

	return cached
		.filter((result) =>
			result.messages.some((message) => reads_other_files(message.ruleId, rules_meta)),
		)
		.map((result) => result.filePath)
}

// The CLI applies `eslint-suppressions.json` whenever it exists and the Node API only when asked, so
// both linters ask: a re-read report otherwise brings back every violation the project suppressed.
function cached_options(options: CrossFileRecheckOptions): ESLint.Options {
	return {
		...options.eslint_options,
		applySuppressions: true,
		cache: true,
		cacheStrategy: 'content',
		cacheLocation: options.cache_file,
	}
}

// A linter that runs without a cache deletes the cache file it would have used, and that defaults to
// the very file the lint run keeps. So the uncached linter is pointed at a sibling path nothing
// ever writes: the re-reading must not cost the next run its whole cache.
function fresh_options(options: CrossFileRecheckOptions): ESLint.Options {
	return {
		...options.eslint_options,
		applySuppressions: true,
		cache: false,
		cacheLocation: `${options.cache_file}${UNCACHED_SUFFIX}`,
	}
}

// `eslint` is loaded here, only past a red report: it is an optional peer a basic-profile
// consumer may not have, and this module is imported by the entry of every `josh lint`, which has to
// reach its skip notice there.
async function create_linters(options: CrossFileRecheckOptions): Promise<Linters> {
	const eslint = await import('eslint')

	return {
		cached: new eslint.ESLint(cached_options(options)),
		fresh: new eslint.ESLint(fresh_options(options)),
		error_results: (results) => eslint.ESLint.getErrorResults(results),
	}
}

async function lint_fresh(
	linter: ESLint,
	suspects: Array<string>,
): Promise<Map<string, ESLint.LintResult>> {
	const fresh = await linter.lintFiles(suspects)

	return new Map(fresh.map((result) => [result.filePath, result]))
}

function merged_results(
	linters: Linters,
	cached: LintResults,
	fresh: Map<string, ESLint.LintResult>,
	options: CrossFileRecheckOptions,
): LintResults {
	const merged = cached.map((entry) => fresh.get(entry.filePath) ?? entry)

	return options.errors_only === true ? linters.error_results(merged) : merged
}

async function report(
	linter: ESLint,
	results: Array<ESLint.LintResult>,
): Promise<Pick<BufferedProcessResult, 'output' | 'exit_code'>> {
	const formatter = await linter.loadFormatter(FORMATTER)
	const is_failed = results.some((result) => result.errorCount > 0)

	return { output: await formatter.format(results), exit_code: is_failed ? FAIL_EXIT_CODE : 0 }
}

// A red about rules that read nothing else is handed back as the run reported it: its cached
// verdicts are about the files they are keyed on.
async function verify(
	result: BufferedProcessResult,
	options: CrossFileRecheckOptions,
): Promise<BufferedProcessResult> {
	if (!is_red(result)) return result
	const started_at = performance.now()
	const linters = await create_linters(options)
	const cached = await linters.cached.lintFiles([...options.patterns])
	const suspects = suspects_of(linters.cached, cached)
	if (suspects.length === 0) return result
	const fresh = await lint_fresh(linters.fresh, suspects)
	const verified = await report(linters.fresh, merged_results(linters, cached, fresh, options))

	return { ...verified, elapsed_ms: result.elapsed_ms + performance.now() - started_at }
}

const cross_file_recheck = { verify }

export type { CrossFileRecheckOptions }
export { cross_file_recheck }
