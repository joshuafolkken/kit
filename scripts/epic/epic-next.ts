#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { epic_busy } from './epic-busy'
import { epic_classify } from './epic-classify'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph, type EpicChild, type GraphAnomaly } from './epic-graph'
import { epic_issue } from './epic-issue'
import { epic_report, type EpicNextResult, type EpicVerdict } from './epic-report'

// `josh epic:next <E>` — which of an epic's children can be started right now, bundled per
// repository, and what the rest are waiting on (joshuafolkken/kit#860).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const REPO_FLAG = '--repo'
const USAGE = 'Usage: josh epic:next <epic-number|owner/repo#number> [--repo <owner/repo>]'
const UNKNOWN_REPO = 'unknown/unknown'
const EXTERNAL_NOTICE = 'Note: this epic tracks children in other repositories.'
// A qualified epic is now read through `gh --repo`, so naming one we do not own would send this
// command to a third party's tracker — which joshuafolkken/kit#869 forbids for a child and forbids
// here for the same reason (joshuafolkken/kit#1016).
const FOREIGN_EPIC = 'That epic belongs to another owner; this command only reads our own.'
// What a repository that is already running something answers. `wait` rather than a number, and
// `wait` rather than `stop`: the holder finishes or its stale label is removed, so asking again is
// what resolves it — exactly the verdict a child carrying `in-progress` already produces.
const BUSY_VERDICT: EpicVerdict = 'wait'
const UNCHECKED_EXCLUSION =
	'Note: the one-child-per-repository exclusion is applied by `--repo`; a child listed here may still be held back there.'

interface NextOptions {
	epic_number?: number
	// The repository the *epic* lives in, when the reference was qualified (`owner/repo#858`).
	epic_repo?: string
	// The repository to narrow the candidates to (`--repo`).
	repo?: string
	usage?: string
}

function parse_repo(rest: ReadonlyArray<string>): string | undefined {
	const flag_index = rest.indexOf(REPO_FLAG)

	return flag_index === -1 ? undefined : rest[flag_index + 1]
}

// `exactOptionalPropertyTypes` rejects `{ epic_repo: undefined }`.
function to_repo_field(repo: string | undefined): { epic_repo?: string } {
	return repo === undefined ? {} : { epic_repo: repo }
}

function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const [first, ...rest] = argv
	const reference = epic_issue.parse_epic_reference(first)
	if (reference === undefined) return { usage: USAGE }
	const base = { epic_number: reference.number, ...to_repo_field(reference.repo) }
	const repo = parse_repo(rest)
	if (repo === undefined) return rest.includes(REPO_FLAG) ? { usage: USAGE } : base

	return { ...base, repo }
}

// The answer for one epic, from an already-fetched snapshot. Split from the fetch so the whole
// decision is testable without GitHub.
// A child that could not be read stops the run. Continuing would answer with a graph that is
// missing a node: an epic whose children all failed to read reads as complete, and one missing child
// leaves whatever it blocks looking unblocked.
//
// Each one is named with the repository it lives in, through the same writer the audit uses: an epic
// tracking `- [ ] sveltejs/kit#7` reported `Could not read #7`, and a reader sent to this
// repository's issue 7 finds a different issue or none (joshuafolkken/kit#1016).
function unreadable_anomaly(snapshot: EpicSnapshot): GraphAnomaly | undefined {
	const missing = epic_fetch.missing_children(snapshot)
	if (missing.length === 0) return undefined
	const list = epic_graph.format_references(missing, snapshot.current_repo)

	return {
		kind: 'unreadable_children',
		message: `Could not read ${list}. The dependency graph would be missing them, so nothing is offered — check \`gh auth status\` and that the issues exist.`,
	}
}

// Whether the body states an order at all. Read through the same parser the links come from, so a
// body whose arrows are all prose cannot count as a declaration with zero links — which would report
// every correct relation as undeclared.
function is_order_declared(body: string | undefined, links: ReadonlyArray<unknown>): boolean {
	return links.length > 0 || git_epic_parse.has_unordered_declaration(body)
}

function decide(
	snapshot: EpicSnapshot,
	paths: ReadonlyMap<string, string> = new Map(),
): EpicNextResult {
	const links = git_epic_parse.parse_dependency_links(snapshot.body)
	const unreadable = unreadable_anomaly(snapshot)
	const anomalies =
		unreadable === undefined
			? epic_graph.find_anomalies(snapshot.children, links, is_order_declared(snapshot.body, links))
			: [unreadable]
	// The cross-repository resolver, not the default one: a blocker in another repository is not
	// finished when it closes, only when its release is published (joshuafolkken/kit#864).
	const classification = epic_classify.classify_children(
		snapshot.children,
		epic_cross_repo.resolve_cross_repo,
	)

	return epic_report.build_result(classification, anomalies, paths)
}

// The verdict as it applies to *this* repository. `run` never reaches a caller here: it means some
// other repository has work, which for this session is something to wait on rather than a state its
// loop has a branch for. The whole-run timeout is what bounds that wait.
function repo_verdict(verdict: EpicVerdict): EpicVerdict {
	return verdict === 'run' ? 'wait' : verdict
}

// The candidate, once the repository has been asked whether anything is already running in it —
// **whichever epic that belongs to** (joshuafolkken/kit#925). The invariant is one child per
// *repository* rather than one per epic, because the working tree, `main` and the `package.json`
// `josh bump` rewrites are shared by every epic that touches this checkout.
//
// Asked only when there *is* a candidate: consulted on `stop` or `complete` too, an unrelated
// `in-progress` issue would turn a finished epic into a permanent `wait`, and neither of those
// verdicts is about to start anything. It also never reaches a third party's tracker, since a child
// in a repository with another owner is refused before it is read (joshuafolkken/kit#869).
//
// **A read that failed answers `wait` too** — never the child, and not an error either
// (`epic-busy.ts` records why both wrong answers are wrong).
async function offer_child(child: EpicChild, repo: string): Promise<number> {
	const busy = await epic_busy.read_repository(repo)

	if (busy.kind === 'idle') {
		console.info(String(child.number))

		return SUCCESS_EXIT_CODE
	}

	console.error(
		busy.kind === 'busy'
			? epic_busy.busy_message(busy.issues, repo)
			: epic_busy.unreadable_message(repo),
	)
	console.info(BUSY_VERDICT)

	return SUCCESS_EXIT_CODE
}

// Print the answer for one repository, as one machine-readable token: the issue number when there
// is a child to run, otherwise the verdict — `wait`, `stop` or `complete`.
//
// The verdict is on stdout rather than only in prose because a loop has to tell "poll again" from
// "stop and report" from "finished"; collapsing all three into one line and exit 0 leaves the caller
// unable to make the distinction the whole classification exists for. Explanations go to stderr, so
// `child=$(josh epic:next 858 --repo …)` still captures a single token.
//
// An unusable graph is checked before a candidate is picked: printing a runnable child while the
// graph is broken would hand a caller work the anomaly says must not start.
async function report_single(result: EpicNextResult, repo: string): Promise<number> {
	if (result.verdict === 'error') {
		console.error(epic_report.format_result(result))

		return FAILURE_EXIT_CODE
	}

	const child = epic_report.pick_for_repo(result, repo)

	if (child === undefined) {
		console.error(`No runnable child in ${repo}.`)
		console.info(repo_verdict(result.verdict))

		return SUCCESS_EXIT_CODE
	}

	return await offer_child(child, repo)
}

// The aggregate listing does not consult the repository-level exclusion — `--repo` is what asks a
// repository whether it is busy, and doing it here would be one listing per repository for a report
// nobody branches on. Said out loud rather than left implicit: this output names runnable children,
// and the `--repo` form may answer `wait` for the very same child (joshuafolkken/kit#925).
function note_unchecked_exclusion(result: EpicNextResult): void {
	if (result.verdict === 'run') console.error(UNCHECKED_EXCLUSION)
}

async function report(
	result: EpicNextResult,
	snapshot: EpicSnapshot,
	repo: string | undefined,
): Promise<number> {
	if (snapshot.has_external_children) console.error(EXTERNAL_NOTICE)
	if (repo !== undefined) return await report_single(result, repo)

	note_unchecked_exclusion(result)

	const text = epic_report.format_result(result)

	if (result.verdict === 'error') {
		console.error(text)

		return FAILURE_EXIT_CODE
	}

	console.info(text)

	return SUCCESS_EXIT_CODE
}

// The checkout each repository's children would be run in comes from joshuafolkken/kit#869's map. A
// repository absent from it is reported without a path rather than cloned.
async function report_epic(snapshot: EpicSnapshot, options: NextOptions): Promise<number> {
	const paths = repo_discovery.discover_repositories(PROJECT_ROOT)

	// One registry answer per repository per invocation. A polling `epicrun` calls this command
	// again each round, and a release that appeared in between has to be seen.
	epic_cross_repo.reset_publish_cache()

	return await report(decide(snapshot, paths), snapshot, options.repo)
}

// A refusal: the reason on stderr, where every other explanation this command prints goes.
function refuse(reason: string): number {
	console.error(reason)

	return FAILURE_EXIT_CODE
}

// Where the epic lives, or nothing when it belongs to another owner. The qualified read added by
// joshuafolkken/kit#1016 goes out as `gh --repo`, so without this a reference naming a third party's
// epic would send this command to their tracker — the read joshuafolkken/kit#869 forbids for a child,
// forbidden here for the same reason.
function epic_repo_of(options: NextOptions, current_repo: string): string | undefined {
	const epic_repo = options.epic_repo ?? current_repo
	const owner = epic_cross_repo.owner_of(current_repo)

	return epic_cross_repo.is_same_owner_repo(epic_repo, owner) ? epic_repo : undefined
}

async function run_epic(options: NextOptions): Promise<number> {
	const epic_number = options.epic_number ?? 0
	const current_repo = (await git_gh_command.repo_get_name_with_owner()) ?? UNKNOWN_REPO
	const epic_repo = epic_repo_of(options, current_repo)
	if (epic_repo === undefined) return refuse(FOREIGN_EPIC)
	const snapshot = await epic_fetch.fetch_epic(epic_number, epic_repo, current_repo)

	if (snapshot.child_numbers.length === 0) {
		return refuse(`#${String(epic_number)} tracks no children in a task list.`)
	}

	return await report_epic(snapshot, options)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.epic_number === undefined) {
		console.error(options.usage ?? USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_epic(options)
}

// `process.exitCode` rather than `process.exit()`, for the reason `scripts/cost/cost-cli.ts` records:
// the answer goes to standard output and a write to a pipe is asynchronous on macOS, so exiting can
// tear the process down before it drains. This command's contract is `answer=$(pnpm josh epic:next
// <E>)`, which is exactly that pipe (joshuafolkken/kit#996).
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const epic_next = {
	USAGE,
	EXTERNAL_NOTICE,
	FOREIGN_EPIC,
	unreadable_anomaly,
	is_order_declared,
	repo_verdict,
	offer_child,
	UNCHECKED_EXCLUSION,
	parse_options,
	run_epic,
	decide,
	report,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { NextOptions }
export { epic_next }
