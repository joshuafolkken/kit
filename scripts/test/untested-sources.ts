import { readdirSync } from 'node:fs'
import path from 'node:path'

// The sources under `scripts/` with no test named after them, frozen.
//
// **Coverage was neither measured nor enforced, so nothing stopped a source landing with no test.**
// This is the regression stop the Issue allowed in place of a coverage threshold: a source whose stem
// names no colocated test — `<stem>.test.ts` or `<stem>-<aspect>.test.ts` beside it — must be listed
// here, and `untested-sources.test.ts` fails on any that is not. A v8 threshold would have needed a
// new dependency and a merge across the three CI unit shards, and still under-counted the CLIs the
// suite drives as subprocesses; a name check is exact, runs inside the unit suite the gate and CI
// already run, and fails on the file that broke it.
//
// **The list only shrinks.** An entry whose source gained a test, or was deleted, fails the same test
// until it is removed, so the frozen set can never hide a file it no longer describes. Adding an entry
// is the one way past the check, and a diff that does so is a reviewer's to question. Most of what is
// here is covered without a test of its own name: the `josh-commands-*` registry rows through
// `josh-commands.test.ts`, the `*-cli.ts` entries through their logic module's suite or the harness,
// and the type, schema and constant modules through every suite that imports them.

const SCRIPTS_DIRECTORY = 'scripts'
const SOURCE_SUFFIX = '.ts'
const TEST_SUFFIX = '.test.ts'
// Not sources of their own: a fixture is test support, and a declaration file carries no code.
const NOT_SOURCE_SUFFIXES: ReadonlyArray<string> = [
	TEST_SUFFIX,
	'-fixture.ts',
	'-fixtures.ts',
	'.d.ts',
]
const ASPECT_SEPARATOR = '-'

const UNTESTED_SOURCES: ReadonlyArray<string> = [
	'scripts/adopt/adopt-logic.ts',
	'scripts/agent/codex-home-source.ts',
	'scripts/backlog/backlog-drive-args.ts',
	'scripts/backlog/backlog-drive-offer-argv.ts',
	'scripts/backlog/backlog-plan-cli.ts',
	'scripts/backlog/backlog-rank.ts',
	'scripts/backlog/backlog-scope.ts',
	'scripts/build/build-codex-hooks.ts',
	'scripts/build/build-library.ts',
	'scripts/build/shim-shell.ts',
	'scripts/ci/composite-actions.ts',
	'scripts/claude/skill-meta.ts',
	'scripts/claude/workflow-destination.ts',
	'scripts/cost-runtime/cost-format.ts',
	'scripts/cost-runtime/transcript-cwd.ts',
	'scripts/delegation/delegation-cli.ts',
	'scripts/delegation/fanout-cli.ts',
	'scripts/document/bash-output-cap.ts',
	'scripts/document/document-scan.ts',
	'scripts/document/generate-catalog.ts',
	'scripts/document/read-set-cost.ts',
	'scripts/document/resident-budget.ts',
	'scripts/document/retired-phrases.ts',
	'scripts/dogfood/dogfood-commit-cli.ts',
	'scripts/epic/epic-audit-checks.ts',
	'scripts/epic/epic-bundle-gaps.ts',
	'scripts/epic/epic-check.ts',
	'scripts/epic/epic-cli-argv.ts',
	'scripts/epic/epic-rank.ts',
	'scripts/epic/epic-read.ts',
	'scripts/epic/epic-shape.ts',
	'scripts/exports/namespace-escape.ts',
	'scripts/followup/followup-issue-number.ts',
	'scripts/followup/git-pr-followup-checks.ts',
	'scripts/gate/gate-tree.ts',
	'scripts/gh/gh-cli-token.ts',
	'scripts/gh/git-gh-helpers.ts',
	'scripts/gh/git-gh-rest-state.ts',
	'scripts/gh/git-pr-coderabbit.ts',
	'scripts/git/git-diff-reads.ts',
	'scripts/git/git-fixture-workspace.ts',
	'scripts/git/git-ls-remote.ts',
	'scripts/git/git-pre-push-hook.ts',
	'scripts/git/git-ssh-keepalive.ts',
	'scripts/git/stash/stash-pop-args.ts',
	'scripts/hooks/format-edited-cli.ts',
	'scripts/hooks/pretool-guard-cli.ts',
	'scripts/init/initial-commit.ts',
	'scripts/init/kit-development-versions.ts',
	'scripts/issue/issue-backlinks-cli.ts',
	'scripts/issue/issue-reference.ts',
	'scripts/josh/file-map-stamp.ts',
	'scripts/josh/josh-command-types.ts',
	'scripts/josh/josh-commands-ai.ts',
	'scripts/josh/josh-commands-backlog.ts',
	'scripts/josh/josh-commands-clone.ts',
	'scripts/josh/josh-commands-development.ts',
	'scripts/josh/josh-commands-document.ts',
	'scripts/josh/josh-commands-guard.ts',
	'scripts/josh/josh-commands-hooks.ts',
	'scripts/josh/josh-commands-lane.ts',
	'scripts/josh/josh-commands-lint.ts',
	'scripts/josh/josh-commands-project.ts',
	'scripts/josh/josh-commands-run.ts',
	'scripts/josh/josh-commands-split.ts',
	'scripts/josh/josh-commands-workflow.ts',
	'scripts/josh/josh-script-reader.ts',
	'scripts/josh/process-owner.ts',
	'scripts/lane/lane-dispatch-log.ts',
	'scripts/lane/openai-lane-supervisor-cli.ts',
	'scripts/lane/openai-lane-supervisor-owner.ts',
	'scripts/lib/status-icons.ts',
	'scripts/overrides/overrides-schemas.ts',
	'scripts/package/production-dependency-graph.ts',
	'scripts/package/verify-optional-eslint-install.ts',
	'scripts/refactor/refactor-scan-cli.ts',
	'scripts/release/publish-tag-cli.ts',
	'scripts/repo/required-checks-report.ts',
	'scripts/report/report-lint-cli.ts',
	'scripts/review/review-attest-cli.ts',
	'scripts/review/review-brief-cli.ts',
	'scripts/review/review-checkout.ts',
	'scripts/rules/bash-triggers.ts',
	'scripts/rules/decision-oracle-batch.ts',
	'scripts/rules/decision-oracle-stage.ts',
	'scripts/rules/decision-oracle-tokens.ts',
	'scripts/rules/delivered-rules-harness.ts',
	'scripts/rules/direct-filing.ts',
	'scripts/rules/oracle-list-cli.ts',
	'scripts/rules/permission-guards.ts',
	'scripts/rules/rule-guard.ts',
	'scripts/rules/tail-commands.ts',
	'scripts/rules/test-declared-commit.ts',
	'scripts/run/run-stranded-cli.ts',
	'scripts/run/run-watcher-guard-cli.ts',
	'scripts/self-sync-guard/index.ts',
	'scripts/sonar/sonar-project.ts',
	'scripts/split/split-assess-cli.ts',
	'scripts/sync/plugin-skill-directories.ts',
	'scripts/sync/sync-ai-files.ts',
	'scripts/test/josh-harness-environment.ts',
	'scripts/test/skip-marker.ts',
	'scripts/test/unit-guard-environment.ts',
	'scripts/test/vitest-include-globs.ts',
	'scripts/time-runtime/time-phase-names.ts',
	'scripts/time-runtime/time-tool-call.ts',
	'scripts/ui/ui-routes-cli.ts',
	'scripts/version/upgrade-shell-command.ts',
	'scripts/version/version-check-arguments.ts',
]

function is_source(file: string): boolean {
	if (!file.endsWith(SOURCE_SUFFIX)) return false

	return NOT_SOURCE_SUFFIXES.every((suffix) => !file.endsWith(suffix))
}

// A test beside the source is named after it when its name is the stem itself or the stem followed
// by an aspect — `gate-plan.test.ts` and `gate-plan-budget.test.ts` both test `gate-plan.ts`.
function names_source(test: string, source: string): boolean {
	if (path.posix.dirname(test) !== path.posix.dirname(source)) return false

	const stem = path.posix.basename(source, SOURCE_SUFFIX)
	const name = path.posix.basename(test, TEST_SUFFIX)

	return name === stem || name.startsWith(`${stem}${ASPECT_SEPARATOR}`)
}

// The sources among `files` that no test among them is named after, in the order given.
function untested(files: ReadonlyArray<string>): Array<string> {
	const tests = files.filter((file) => file.endsWith(TEST_SUFFIX))

	return files
		.filter((file) => is_source(file))
		.filter((source) => tests.every((test) => !names_source(test, source)))
}

// Every file under `scripts/`, as a repository-relative path with forward slashes.
function scripts_files(root: string): Array<string> {
	return readdirSync(path.join(root, SCRIPTS_DIRECTORY), { recursive: true, encoding: 'utf8' }).map(
		(file) => path.posix.join(SCRIPTS_DIRECTORY, file.split(path.sep).join(path.posix.sep)),
	)
}

const untested_sources = { UNTESTED_SOURCES, scripts_files, untested }

export { untested_sources }
