import { stamp_file } from '#scripts/josh/stamp-file'
import { effective_limit } from '#scripts/lines/effective-limit'
import { line_budget } from '#scripts/lines/line-budget'
import { ESLint } from 'eslint'

// The code-line count `josh metrics` totals, asked of eslint's own `max-lines` exactly as
// `line_budget` asks it, but **in process and with every other rule filtered out**.
// The CLI probe `josh lines` spawns runs the project's whole rule set over
// the files — about 37 seconds across `scripts/` — because the CLI has no way to run one rule; the
// API's `ruleFilter` brings the same count to a few seconds, which is what lets the gate run it.
//
// **It reads one line lower than `josh lines` on a file that starts with `#!`.** `line-budget.ts`
// records why the API counts a hashbang as a comment where the CLI counts it as code, and why a
// per-file budget must therefore stay on the CLI. A total compared only against its own baseline
// needs the same method on both sides, not the CLI's, so the difference never reaches a verdict.
//
// **The same method has to mean the same number on every machine, so type-aware parsing is off.**
// With `project` set, typescript-eslint infers a "single run" whenever `CI=true` (or the process is
// the eslint bin) and then takes each file's AST from a program it read from disk, where TypeScript
// keeps `#!` as trivia instead of the comment ESLint rewrote it to — so CI counted every hashbang as
// code and saw `scripts.code_lines` 150 above the baseline a local run had just written. That
// inference is also the CLI/API difference above. `max-lines` reads no type information, so parsing
// without a program gives one answer everywhere, and in a fraction of the time.
const UNTYPED_PARSE = { languageOptions: { parserOptions: { project: false } } }

const MAX_LINES_RULE = 'max-lines'
// The API deletes whatever `cacheLocation` names whenever `cache` is off, and its default is the
// `.eslintcache` the gate's lint runs beside this step on — the same wipe the CLI does. Pointed outside the checkout, it removes a file nothing ever writes.
const CACHE_PREFIX = 'josh-metrics-eslint-cache-'

function is_max_lines(rule: { ruleId: string }): boolean {
	return rule.ruleId === MAX_LINES_RULE
}

async function group_counts(
	root: string,
	group: { options: Parameters<typeof line_budget.probe_rules>[0]; paths: Array<string> },
): Promise<ReadonlyMap<string, number>> {
	const eslint = new ESLint({
		cwd: root,
		cacheLocation: stamp_file.stamp_path(CACHE_PREFIX, root),
		allowInlineConfig: false,
		ruleFilter: is_max_lines,
		overrideConfig: { ...UNTYPED_PARSE, rules: line_budget.probe_rules(group.options) },
	})

	return line_budget.counts_from(await eslint.lintFiles(group.paths))
}

// Keyed by absolute path, as `line_budget.counts_from` keys it. A file eslint sets no `max-lines` on
// is absent, so it is left out of every total rather than counted as zero code lines.
async function code_line_counts(
	file_paths: ReadonlyArray<string>,
	root: string,
): Promise<ReadonlyMap<string, number>> {
	const options = await effective_limit.options_for(file_paths, root)
	const groups = [...line_budget.grouped(options).values()]
	const counted = await Promise.all(groups.map(async (group) => await group_counts(root, group)))

	return new Map(counted.flatMap((counts) => [...counts]))
}

const metrics_code_lines = { code_line_counts }

export { metrics_code_lines }
