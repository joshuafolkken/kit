#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import type { ConfirmContext } from './epic-candidate-confirm'
import { epic_classify } from './epic-classify'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph, type EpicChild, type GraphAnomaly } from './epic-graph'
import { epic_issue } from './epic-issue'
import { epic_lane_offer, type LaneOffer, type LaneRequest } from './epic-lane-offer'
import { epic_report, type EpicNextResult, type EpicVerdict } from './epic-report'

// `josh epic:next <E>` — which of an epic's children can be started right now, bundled per
// repository, and what the rest are waiting on (joshuafolkken/kit#860).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const REPO_FLAG = '--repo'
// Asking for every free lane is opt-in, so the answer stays one token for a caller that has not been
// changed. `--repo` alone still prints exactly one number — what joshuafolkken/kit#1491 changed for
// it is *when* that number appears, not how many arrive (joshuafolkken/kit#1491).
const LANES_FLAG = '--lanes'
const FLAG_PREFIX = '--'
const USAGE =
	'Usage: josh epic:next <epic-number|owner/repo#number> [--repo <owner/repo>] [--lanes]'
// A repository that could not be read is refused rather than stood in for. Since
// joshuafolkken/kit#1126 a blocker carries the repository it lives in, so a placeholder on the
// children keys them as `unknown/unknown#N` while their blockers keep their real names: every
// relation misses, `from_blockers([])` calls the child runnable, and an unattended run starts a
// dependent before its prerequisite. The old placeholder was harmless only while every blocker
// inherited the child's own repository — it matched itself.
const UNKNOWN_REPO =
	'Could not read this repository from `git remote`, so the children cannot be keyed by repository — check `gh auth status` and that this is a checkout with an `origin` remote.'
const EXTERNAL_NOTICE = 'Note: this epic tracks children in other repositories.'
// A qualified epic is read by naming its repository in the read's REST path, so naming one we do
// not own would send this command to a third party's tracker — which joshuafolkken/kit#869 forbids
// for a child and forbids here for the same reason (joshuafolkken/kit#1016).
const FOREIGN_EPIC = 'That epic belongs to another owner; this command only reads our own.'
const NO_CHILDREN = 0
const UNCHECKED_EXCLUSION =
	'Note: the per-repository lane count is applied by `--repo`; a child listed here may still be held back there while every lane is in use.'

interface NextOptions {
	epic_number?: number
	// The repository the *epic* lives in, when the reference was qualified (`owner/repo#858`).
	epic_repo?: string
	// The repository to narrow the candidates to (`--repo`).
	repo?: string
	// Whether to fill every free lane (`--lanes`) rather than answering with a single child.
	is_all_lanes?: boolean
	usage?: string
}

// A value that is itself a flag is no value at all. `--repo --lanes` used to narrow to a repository
// literally named `--lanes` and report `No runnable child in --lanes` with exit 0; refused here, it
// reaches the usage line instead — the caller meant a repository and named none.
function parse_repo(rest: ReadonlyArray<string>): string | undefined {
	const flag_index = rest.indexOf(REPO_FLAG)
	const value = flag_index === -1 ? undefined : rest[flag_index + 1]

	return value?.startsWith(FLAG_PREFIX) === true ? undefined : value
}

// `exactOptionalPropertyTypes` rejects `{ epic_repo: undefined }`.
function to_repo_field(repo: string | undefined): { epic_repo?: string } {
	return repo === undefined ? {} : { epic_repo: repo }
}

// `--lanes` without `--repo` is refused rather than ignored: the lane count is a property of one
// repository, so the aggregate listing has nothing to apply it to, and a flag that silently does
// nothing is a caller believing it asked for something.
function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const [first, ...rest] = argv
	const reference = epic_issue.parse_epic_reference(first)
	if (reference === undefined) return { usage: USAGE }
	const base = { epic_number: reference.number, ...to_repo_field(reference.repo) }
	const repo = parse_repo(rest)
	const is_all_lanes = rest.includes(LANES_FLAG)
	if (repo === undefined) return is_all_lanes || rest.includes(REPO_FLAG) ? { usage: USAGE } : base

	return { ...base, repo, is_all_lanes }
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
//
// Deliberately a disjunction where `epic:check` takes exactly one of the two: a body declaring both
// a chain and the `None — ...` literal is a contradiction, and reporting it is the check's job
// (joshuafolkken/kit#1155). Refusing to hand out work here as well would stop an unattended run on a
// body whose declared chain and recorded relations agree — a worse outcome than following the chain
// the run's own `epic:check` already flagged.
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
			? epic_graph.find_anomalies(
					snapshot.children,
					links,
					is_order_declared(snapshot.body, links),
					snapshot.repo,
				)
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

// The confirmed candidates' numbers, one per line, or the verdict that stands in their place when
// there was no free lane or the relations listing withheld every one of them
// (joshuafolkken/kit#1121). Standard output carries numbers or a verdict and nothing else, so
// `child=$(josh epic:next … --repo …)` is unchanged for the caller that asked for one child — which
// is every caller that did not pass `--lanes`.
function report_offer(offer: LaneOffer): number {
	if (offer.notice !== '') console.error(offer.notice)

	if (offer.children.length === NO_CHILDREN) {
		console.info(repo_verdict(offer.verdict))

		return SUCCESS_EXIT_CODE
	}

	for (const child of offer.children) console.info(String(child.number))

	return SUCCESS_EXIT_CODE
}

// The candidates, once the repository has been asked **how many lanes it already has running** —
// whichever epic those belong to (joshuafolkken/kit#925, counted rather than excluded since
// joshuafolkken/kit#1491). The invariant is per *repository* rather than per epic, and it is a
// ceiling on how many children run there at once rather than a lock on the whole checkout.
//
// Asked only when there *is* a candidate: consulted on `stop` or `complete` too, an unrelated
// `in-progress` issue would turn a finished epic into a permanent `wait`, and neither of those
// verdicts is about to start anything. It also never reaches a third party's tracker, since a child
// in a repository with another owner is refused before it is read (joshuafolkken/kit#869).
//
// **A read that failed answers `wait` too** — never a child, and not an error either
// (`epic-busy.ts` records why both wrong answers are wrong). **So does a listing that was cut
// short**: since joshuafolkken/kit#1067 the page ceiling bounds this listing as well, and a short
// listing with no visible holder is not "nothing is running".
//
// One pool is passed today because one epic was named. Nothing below this line knows that
// (`epic-lane-offer.ts` records why), so a caller that eventually names two epics passes two pools.
async function offer_children(
	candidates: ReadonlyArray<EpicChild>,
	request: LaneRequest,
	context: ConfirmContext,
): Promise<number> {
	return report_offer(await epic_lane_offer.offer_for_repo([{ candidates, context }], request))
}

// What the candidate confirmation reads with. The blockers come from `epic_fetch`'s own reader, so
// a candidate is addressed exactly as every other read of a child is — a cross-repository child
// through its own repository, and a local one bare (joshuafolkken/kit#1012).
function confirm_context(snapshot: EpicSnapshot): ConfirmContext {
	return {
		children: snapshot.children,
		resolve: epic_cross_repo.resolve_cross_repo,
		read_blockers: async (child) =>
			await epic_fetch.read_child_blockers(child, snapshot.current_repo),
	}
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
async function report_single(
	result: EpicNextResult,
	request: LaneRequest,
	snapshot: EpicSnapshot,
): Promise<number> {
	if (result.verdict === 'error') {
		console.error(epic_report.format_result(result))

		return FAILURE_EXIT_CODE
	}

	const candidates = epic_report.candidates_for_repo(result, request.repo)

	if (candidates.length === NO_CHILDREN) {
		console.error(`No runnable child in ${request.repo}.`)
		console.info(repo_verdict(result.verdict))

		return SUCCESS_EXIT_CODE
	}

	return await offer_children(candidates, request, confirm_context(snapshot))
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
	request: LaneRequest | undefined,
): Promise<number> {
	if (snapshot.has_external_children) console.error(EXTERNAL_NOTICE)
	if (request !== undefined) return await report_single(result, request, snapshot)

	note_unchecked_exclusion(result)

	const text = epic_report.format_result(result)

	if (result.verdict === 'error') {
		console.error(text)

		return FAILURE_EXIT_CODE
	}

	console.info(text)

	return SUCCESS_EXIT_CODE
}

// A refusal: the reason on stderr, where every other explanation this command prints goes.
function refuse(reason: string): number {
	console.error(reason)

	return FAILURE_EXIT_CODE
}

// The checkout each repository's children would be run in comes from joshuafolkken/kit#869's map. A
// repository absent from it is reported without a path rather than cloned.
async function report_epic(snapshot: EpicSnapshot, options: NextOptions): Promise<number> {
	const paths = repo_discovery.discover_repositories(PROJECT_ROOT)

	// One registry answer per repository per invocation. A polling `epicrun` calls this command
	// again each round, and a release that appeared in between has to be seen.
	epic_cross_repo.reset_publish_cache()
	epic_classify.reset_reported()

	const result = decide(snapshot, paths)
	if (options.repo === undefined) return await report(result, snapshot, undefined)

	const choice = lane_capacity.lane_limit()
	if (choice.kind === 'problem') return refuse(choice.problem)

	return await report(result, snapshot, {
		repo: options.repo,
		limit: choice.limit,
		is_all_lanes: options.is_all_lanes ?? false,
	})
}

// Where the epic lives, or nothing when it belongs to another owner. The qualified read added by
// joshuafolkken/kit#1016 names that repository in its REST path, so without this a reference naming
// a third party's epic would send this command to their tracker — the read joshuafolkken/kit#869
// forbids for a child, forbidden here for the same reason.
function epic_repo_of(options: NextOptions, current_repo: string): string | undefined {
	const epic_repo = options.epic_repo ?? current_repo
	const owner = epic_cross_repo.owner_of(current_repo)

	return epic_cross_repo.is_same_owner_repo(epic_repo, owner) ? epic_repo : undefined
}

async function run_epic(options: NextOptions): Promise<number> {
	const epic_number = options.epic_number ?? 0
	const current_repo = await git_gh_command.repo_get_name_with_owner()
	if (current_repo === undefined) return refuse(UNKNOWN_REPO)
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
	offer_children,
	report_offer,
	confirm_context,
	UNCHECKED_EXCLUSION,
	parse_options,
	run_epic,
	decide,
	report,
	run,
	main,
}

// `.env` is read here rather than through the dispatcher's `tsx_arguments`: declaring any would
// disqualify this command from in-process dispatch, and an unattended `epicrun` asks it every sixty
// seconds for the whole life of a run (`josh-environment-file.ts` records the measurement). Inside the guard
// rather than in `main`, so a developer's own `.env` cannot decide what the unit tests see.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	await main(process.argv.slice(ARGV_OFFSET))
}

export type { NextOptions }
export { epic_next }
