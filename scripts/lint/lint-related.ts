#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { document_checks } from '#scripts/document/document-checks'
import { unused_members_check } from '#scripts/exports/unused-members-check'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { structural_checks } from '#scripts/gate/structural-checks'
import { verification_tail } from '#scripts/gate/verification-tail'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { review_stamps } from '#scripts/review/review-stamps'
import { split_early_notice } from '#scripts/split/split-early-notice'
import { lint_parallel } from './lint-parallel'
import { lint_related_scope } from './lint-related-scope'

// `josh lint:related` — the lint check an implementation loop runs between edits.
// The narrowing itself is `lint-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches the same
// two child processes `josh lint` runs.

// Flags are named rather than forwarded. `josh test:related` forwards them because it has one
// child; this has two, and prettier and eslint take different ones — `--fix` means something to
// eslint and nothing to `prettier --check`. Sending a flag to both would fail the run over the
// argument list, and dropping it silently would run a check the caller did not ask for, so the run
// says which arguments it ignored.
function report_ignored_flags(command_arguments: ReadonlyArray<string>): void {
	const flags = changed_file_scope.flags_of(command_arguments)

	if (flags.length === 0) return

	process.stdout.write(
		`${lint_related_scope.COMMAND_LABEL}: ignored — prettier and eslint take different flags: ${flags.join(' ')}\n`,
	)
}

// A fallback to the whole project is a superset of the changed files, so it vouches for them too —
// which is why the record below is written from either arm rather than only from the narrow one.
async function lint_exit_code(scope: ChangedFileScope): Promise<number> {
	if (scope.mode === 'all') return await lint_parallel.run_lint_parallel_checks()

	return await lint_parallel.run_lint_checks(
		lint_related_scope.prettier_arguments(scope.files),
		lint_related_scope.eslint_arguments(scope.files),
		lint_related_scope.RELATED_CACHES.eslint_file,
		{ warm_daemon: true },
	)
}

// The document checks over the same scope the lint just ran: the resolved file list when narrowed,
// and the whole budget when lint fell back to the whole tree — so each is a superset in the
// fallback exactly as lint is, never an empty list that would pass silently. Both run, so one edit
// reports its byte ceiling and its ratchets (`document-ratchet-check.ts`) in one pass.
function document_check_exit_code(scope: ChangedFileScope, root: string): number {
	if (scope.mode === 'all') return document_checks.check_all(root)

	return document_checks.check_files(root, scope.files)
}

interface LintOutcome {
	stage: string
	exit_code: number
}

const UNMOVED: LintOutcome = { stage: 'unmoved', exit_code: 0 }

function is_failed(outcome: LintOutcome): boolean {
	return outcome.exit_code !== 0
}

// The lint result folded together with the fast document checks: the
// same checks the gate's `document-byte-budget.test.ts`, `command-reference.test.ts` and
// `issue-citation-budget.test.ts` run, brought forward to this between-edits path so a mandated
// documentation update over a ceiling surfaces in seconds. It reads no change
// of its own — it takes the files this run already resolved, so the git contract is the lint
// command's alone. A lint failure is reported as-is; only a green lint runs the document checks, so the
// two never race to the exit code, and a green tree here is green on both — which is what the record
// below then vouches for. The structural checks (`structural-checks.ts`) run beside the lint rather
// than after it, so their whole-program scan costs no wall clock the lint has not already spent.
//
// The gate's `exports` check comes after them on the same terms: a namespace member nothing reads is
// reported here for the namespaces the changed files declare or import directly
// (joshuafolkken/kit#4645, joshuafolkken/kit#4649), rather than at ship's pre-detach gate. The
// fallback scans the whole program, a superset as the lint's is.
//
// The outcome names the stage that failed first, which the verdict line names (joshuafolkken/kit#5162).
async function scoped_outcome(scope: ChangedFileScope, root: string): Promise<LintOutcome> {
	const structural = structural_checks.run_structural(scope, root)
	const lint = { stage: 'lint', exit_code: await lint_exit_code(scope) }
	const failed = [lint, { stage: 'structural', exit_code: await structural }].find((outcome) =>
		is_failed(outcome),
	)

	if (failed !== undefined) return failed
	// The linters' buffered output ends without a newline; keep the checks' own lines apart from it.
	process.stdout.write('\n')
	const documents = { stage: 'documents', exit_code: document_check_exit_code(scope, root) }
	if (is_failed(documents)) return documents

	const files = scope.mode === 'all' ? undefined : scope.files

	return {
		stage: 'unused members',
		exit_code: await unused_members_check.run_unused_members(root, files),
	}
}

// **A bare run reads only what moved since its last green run** (`since-green.ts`), against the tree
// its green record is read from, so one run reads the gate tree once (joshuafolkken/kit#4655).
// Explicit file arguments read no tree, so they never consult the record.
async function read_since_green(
	before: GateTree | undefined,
): Promise<ReadonlyArray<string> | undefined> {
	if (before === undefined) return undefined

	return await since_green.read_moved(
		review_stamps.lint_related_stamp,
		gate_labels.LINT_LABEL,
		undefined,
		before,
	)
}

// Narrowed to what moved while a lintable file is among it; otherwise the whole branch change, as before.
function since_green_scope(
	root: string,
	moved: ReadonlyArray<string> | undefined,
): ChangedFileScope | undefined {
	if (moved === undefined) return undefined

	const inputs = lint_related_scope.scope_inputs(existsSync)
	const files = moved.map((file) => path.join(root, file))

	if (changed_file_scope.select_files(files, inputs).length === 0) return undefined

	process.stdout.write(`${since_green.describe(lint_related_scope.COMMAND_LABEL, moved)}\n`)

	return changed_file_scope.resolve_scope(files, inputs)
}

async function resolve_lint_scope(
	command_arguments: ReadonlyArray<string>,
	root: string,
	moved: ReadonlyArray<string> | undefined,
): Promise<ChangedFileScope> {
	const since = since_green_scope(root, moved)

	if (since !== undefined) return since

	return await changed_file_scope.resolve_command_scope({
		command_arguments,
		root,
		inputs: lint_related_scope.scope_inputs(existsSync),
	})
}

// In kit, a metrics total grown past the merge-base is reported after the lint and changes no exit
// code (`metrics-totals.ts`). The totals are a whole-repository pass, so only a green bare run pays
// for it: a red lint is edited again anyway, and a run narrowed by file arguments is a spot check.
async function outcome_with_notice(
	command_arguments: ReadonlyArray<string>,
	scope: ChangedFileScope,
	root: string,
): Promise<LintOutcome> {
	const outcome = await scoped_outcome(scope, root)
	if (is_failed(outcome) || command_arguments.length > 0) return outcome

	const notice = await metrics_totals.growth_notice(root)

	// On a line of its own: a linter's buffered output need not end with a newline.
	if (notice !== undefined) process.stdout.write(`\n${notice}\n`)

	return outcome
}

// The narrowing line is printed before either child starts, so a scoped run is never read as a
// whole one, and a fallback says which of the two it was rather than looking like a narrow run
// that found nothing.
function report_scope(
	command_arguments: ReadonlyArray<string>,
	scope: ChangedFileScope,
	root: string,
): void {
	changed_file_scope.report_unusable_arguments(
		command_arguments,
		scope,
		lint_related_scope.COMMAND_LABEL,
	)
	report_ignored_flags(command_arguments)
	process.stdout.write(`${lint_related_scope.describe_scope(scope, root)}\n`)
}

// **Nothing moved since the last green run lints nothing** (joshuafolkken/kit#4593), as
// `josh test:related` runs no test.
function report_unmoved(): LintOutcome {
	process.stdout.write(
		`${lint_related_scope.COMMAND_LABEL}: ${since_green.UNMOVED_REASON} — linting nothing.\n`,
	)

	return UNMOVED
}

async function checked_outcome(
	command_arguments: ReadonlyArray<string>,
	root: string,
	moved: ReadonlyArray<string> | undefined,
): Promise<LintOutcome> {
	if (moved?.length === 0) return report_unmoved()

	const scope = await resolve_lint_scope(command_arguments, root, moved)

	report_scope(command_arguments, scope, root)

	return await outcome_with_notice(command_arguments, scope, root)
}

// The run's last line names the stage that failed, or says it passed; the console is the only copy of
// the output, so there is no log notice (`verification-tail.ts`).
function report_verdict(outcome: LintOutcome): void {
	const failed = is_failed(outcome) ? [outcome.stage] : []
	const verdict = verification_tail.format_verdict(lint_related_scope.COMMAND_LABEL, failed)

	process.stdout.write(`\n${verification_tail.format_tail({ failures: '', verdict })}`)
}

// **A green run leaves a record of the tree it was green on**, so
// `josh review:brief` can tell a tree this check has read from one it has not. What the record means,
// and the three states in which it is withheld, are `scoped-green.ts`. An unmoved run records too, as
// `josh test:related`'s does: a main sync can move the base while moving no path, and a record left on
// the old base would refuse `josh gate` while every re-run kept linting nothing.
async function run_related_lint(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const before = await scoped_green.read_before(command_arguments)
	const moved = await read_since_green(before)
	const outcome = await checked_outcome(command_arguments, root, moved)

	report_verdict(outcome)
	await scoped_green.record_if_green(review_stamps.lint_related_stamp, {
		before,
		exit_code: outcome.exit_code,
	})

	return outcome.exit_code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_related_lint(process.argv.slice(changed_file_scope.ARGV_START))
	await split_early_notice.surface()
}

const lint_related = { run_related_lint }

export { lint_related }
