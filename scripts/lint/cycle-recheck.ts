import { FAIL_EXIT_CODE, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import type { ESLint } from 'eslint'

// `import/no-cycle` reads other files, and the lint cache keys a verdict on the linted file's own
// content. So once a cycle is closed by editing one side of it, the untouched side keeps its cached
// `Dependency cycle detected` until its own content changes (joshuafolkken/kit#3641). The opposite
// error cannot happen: a new cycle always contains the file that gained the import, and that file is
// re-linted.
//
// A lint run therefore re-reads a cached red that names the rule: the files reported for it are
// linted once more without the cache, and their fresh results replace the cached ones. A run that
// reports no cycle never reaches this, so the green path costs what it did.
//
// That holds for a run narrowed to one change's files as much as for the whole tree: the change can
// hold both sides of a cycle, and the side a later edit leaves alone keeps its cached report.
//
// The cached run is asked again through the Node API rather than read off the first run's report:
// that report is the stylish text, and taking a file out of it means re-deriving its problem
// counts. The second asking is answered from the cache the first one just wrote.
const NO_CYCLE_RULE = 'import/no-cycle'
const FORMATTER = 'stylish'
const UNCACHED_SUFFIX = '.uncached'

interface Linters {
	cached: ESLint
	fresh: ESLint
}

interface CycleRecheckOptions {
	cache_file: string
	// What the run linted — the whole tree, or one change's files — so the cached run is asked the
	// question it was asked the first time.
	patterns: ReadonlyArray<string>
	// What the fixture test varies: the directory linted and the configuration it is linted with.
	eslint_options?: ESLint.Options
}

// The exit code is eslint's "finished and reported problems", not any failure: a run that could not
// finish — a configuration that does not load, a rule that threw — exits 2 and may name the rule
// too, and asking it again throws the same error here, ahead of both buffered reports.
function is_cycle_reported(result: BufferedProcessResult): boolean {
	return result.exit_code === FAIL_EXIT_CODE && result.output.includes(NO_CYCLE_RULE)
}

function has_cycle_message(result: ESLint.LintResult): boolean {
	return result.messages.some((message) => message.ruleId === NO_CYCLE_RULE)
}

function cached_options(options: CycleRecheckOptions): ESLint.Options {
	return {
		...options.eslint_options,
		cache: true,
		cacheStrategy: 'content',
		cacheLocation: options.cache_file,
	}
}

// A linter that runs without a cache deletes the cache file it would have used, and that defaults to
// the very file the lint run keeps. So the uncached linter is pointed at a sibling path nothing
// ever writes: the re-reading must not cost the next run its whole cache.
function fresh_options(options: CycleRecheckOptions): ESLint.Options {
	return {
		...options.eslint_options,
		cache: false,
		cacheLocation: `${options.cache_file}${UNCACHED_SUFFIX}`,
	}
}

// `eslint` is loaded here, only past the cycle report: it is an optional peer a basic-profile
// consumer may not have, and this module is imported by the entry of every `josh lint`, which has to
// reach its skip notice there.
async function create_linters(options: CycleRecheckOptions): Promise<Linters> {
	const eslint = await import('eslint')

	return {
		cached: new eslint.ESLint(cached_options(options)),
		fresh: new eslint.ESLint(fresh_options(options)),
	}
}

async function lint_fresh(
	linter: ESLint,
	cached: ReadonlyArray<ESLint.LintResult>,
): Promise<Map<string, ESLint.LintResult>> {
	const suspects = cached.filter((result) => has_cycle_message(result))
	if (suspects.length === 0) return new Map()
	const fresh = await linter.lintFiles(suspects.map((result) => result.filePath))

	return new Map(fresh.map((result) => [result.filePath, result]))
}

async function report(
	linter: ESLint,
	results: Array<ESLint.LintResult>,
): Promise<Pick<BufferedProcessResult, 'output' | 'exit_code'>> {
	const formatter = await linter.loadFormatter(FORMATTER)
	const is_failed = results.some((result) => result.errorCount > 0)

	return { output: await formatter.format(results), exit_code: is_failed ? FAIL_EXIT_CODE : 0 }
}

async function verify(
	result: BufferedProcessResult,
	options: CycleRecheckOptions,
): Promise<BufferedProcessResult> {
	if (!is_cycle_reported(result)) return result
	const started_at = performance.now()
	const linters = await create_linters(options)
	const cached = await linters.cached.lintFiles([...options.patterns])
	const fresh = await lint_fresh(linters.fresh, cached)
	const verified = await report(
		linters.fresh,
		cached.map((entry) => fresh.get(entry.filePath) ?? entry),
	)

	return { ...verified, elapsed_ms: result.elapsed_ms + performance.now() - started_at }
}

const cycle_recheck = { verify }

export type { CycleRecheckOptions }
export { cycle_recheck, NO_CYCLE_RULE }
