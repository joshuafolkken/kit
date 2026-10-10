#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { cli_flags } from '#scripts/lib/cli-flags'
import { issue_citation } from '#scripts/rules/issue-citation'
import { epic_classify } from './epic-classify'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph, type GraphAnomaly } from './epic-graph'
import { epic_issue, type EpicReference } from './epic-issue'
import { epic_lane_offer, type LaneOffer, type LaneRequest } from './epic-lane-offer'
import { epic_next_read, type EpicRead, type SnapshotReads } from './epic-next-read'
import { epic_next_views, type EpicView } from './epic-next-views'
import { epic_outside_blocker } from './epic-outside-blocker'
import { epic_parse } from './epic-parse'
import { epic_report, type EpicNextResult } from './epic-report'

// `josh epic:next <E…>` — which of the named epics' children can be started right now, bundled per
// repository, and what the rest are waiting on.
//
// **Several epics answer as one**. Every leading argument is an epic
// reference, and their children merge into one candidate pool per repository — so a repository with
// six free lanes fills them from every named epic rather than from whichever one was typed first.
// The merge itself, and why the priority order is the order they were named, is
// `epic-next-views.ts`; the de-duplication of a child two epics both track is
// `epic_lane_offer.dedupe_pools`.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
// Asking for every free lane (`--lanes`) is opt-in, so the answer stays one token for a caller that
// has not been changed. `--repo` alone prints exactly one number.
const OPTIONS = { repo: { type: 'string' }, lanes: { type: 'boolean' } } as const
const USAGE =
	'Usage: josh epic:next <epic-number|owner/repo#number>... [--repo <owner/repo>] [--lanes]'
// A repository that could not be read is refused rather than stood in for. A blocker carries the
// repository it lives in, so a placeholder on the children would key them as `unknown/unknown#N`
// while their blockers keep their real names: every relation misses, `from_blockers([])` calls the
// child runnable, and an unattended run starts a dependent before its prerequisite.
const UNKNOWN_REPO =
	'Could not read this repository from `git remote`, so the children cannot be keyed by repository — check `gh auth status` and that this is a checkout with an `origin` remote.'
const EXTERNAL_NOTICE = 'Note: this epic tracks children in other repositories.'
const { FOREIGN_EPIC } = epic_next_read
const NO_CHILDREN = 0
const ONE_EPIC = 1
const UNCHECKED_EXCLUSION =
	'Note: the per-repository lane count is applied by `--repo`; a child listed here may still be held back there while every lane is in use.'

interface NextOptions {
	// Every epic named, in the order they were named — which is the order their children then take
	// free lanes in. Each reference carries the repository the *epic* lives
	// in when it was qualified (`owner/repo#858`).
	references?: ReadonlyArray<EpicReference>
	// The repository to narrow the candidates to (`--repo`).
	repo?: string
	// Whether to fill every free lane (`--lanes`) rather than answering with a single child.
	is_all_lanes?: boolean
	usage?: string
}

// Every leading entry, or nothing. One entry that does not parse fails the whole read rather than
// being dropped: a mistyped second epic would otherwise run the first one alone and report nothing
// at all about the one that was missed — an unattended run silently doing half of what was asked.
function parse_references(head: ReadonlyArray<string>): ReadonlyArray<EpicReference> | undefined {
	const references: Array<EpicReference> = []

	for (const entry of head) {
		const reference = epic_issue.parse_epic_reference(entry)

		if (reference === undefined) return undefined
		references.push(reference)
	}

	return references.length === 0 ? undefined : references
}

function with_repo(
	references: ReadonlyArray<EpicReference>,
	values: { repo?: string; lanes?: boolean },
): NextOptions {
	const { repo, lanes: is_all_lanes = false } = values

	if (repo === undefined) return is_all_lanes ? { usage: USAGE } : { references }

	return { references, repo, is_all_lanes }
}

// The positional arguments are epic references and the flags are options, so `epic:next 858 909 --repo
// X` reads two epics and `epic:next 858 --repo X` still reads one. The read is
// strict: an unknown flag reaches the usage line rather than being ignored, and a value that is itself
// a flag is no value at all — `--repo --lanes` must not narrow to a repository literally named
// `--lanes` and report `No runnable child in --lanes` with exit 0.
//
// `--lanes` without `--repo` is refused rather than ignored: the lane count is a property of one
// repository, so the aggregate listing has nothing to apply it to, and a flag that silently does
// nothing is a caller believing it asked for something. An empty name (`--repo=` from an unset
// variable) is no repository either: narrowed to it, the answer is `No runnable child in .` and exit 0.
function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return { usage: USAGE }
	const references = parse_references(parsed.positionals)
	if (references === undefined || parsed.values.repo === '') return { usage: USAGE }

	return with_repo(references, parsed.values)
}

// The answer for one epic, from an already-fetched snapshot. Split from the fetch so the whole
// decision is testable without GitHub.
// A child that could not be read stops the run. Continuing would answer with a graph that is
// missing a node: an epic whose children all failed to read reads as complete, and one missing child
// leaves whatever it blocks looking unblocked.
//
// Each one is named with the repository it lives in, through the same writer the audit uses: an epic
// tracking `- [ ] sveltejs/kit#7` reporting `Could not read #7` would send a reader to this
// repository's issue 7, a different issue or none.
// **The epic's own body failing to read is its own anomaly, ahead of the children's**.
// Without it the failure is silent: a body that never arrived parses to
// zero children, the epic is dropped from the views as an unpopulated one, no anomaly is raised, and
// the verdict falls through to `complete` — which `backlog:next` prints as `none`, so the run reports
// the backlog exhausted over one request that never left the machine. It is checked first because a
// body nobody read says nothing about the children either.
function body_anomaly(snapshot: EpicSnapshot): GraphAnomaly | undefined {
	if (snapshot.body_failure === undefined) return undefined

	return {
		kind: 'unreadable_epic_body',
		message: `Could not read the body of the epic in ${snapshot.repo}. Its task list is what names the children, so nothing is offered — check \`gh auth status\` and that the epic exists.`,
		is_unreachable: snapshot.is_unreachable,
	}
}

function unreadable_anomaly(snapshot: EpicSnapshot): GraphAnomaly | undefined {
	const missing = epic_fetch.missing_children(snapshot)
	if (missing.length === 0) return undefined
	const list = epic_graph.format_references(missing, snapshot.current_repo)

	return {
		kind: 'unreadable_children',
		message: `Could not read ${list}. The dependency graph would be missing them, so nothing is offered — check \`gh auth status\` and that the issues exist.`,
		is_unreachable: snapshot.is_unreachable,
	}
}

// Whether the body states an order at all. Read through the same parser the links come from, so a
// body whose arrows are all prose cannot count as a declaration with zero links — which would report
// every correct relation as undeclared.
//
// Deliberately a disjunction where `epic:check` takes exactly one of the two: a body declaring both
// a chain and the `None — ...` literal is a contradiction, and reporting it is the check's job.
// Refusing to hand out work here as well would stop an unattended run on a
// body whose declared chain and recorded relations agree — a worse outcome than following the chain
// the run's own `epic:check` already flagged.
function is_order_declared(body: string | undefined, links: ReadonlyArray<unknown>): boolean {
	return links.length > 0 || epic_parse.has_unordered_declaration(body)
}

function decide(
	snapshot: EpicSnapshot,
	paths: ReadonlyMap<string, string> = new Map(),
	running?: ReadonlySet<string>,
): EpicNextResult {
	const links = epic_parse.parse_dependency_links(snapshot.body)
	const unreadable = body_anomaly(snapshot) ?? unreadable_anomaly(snapshot)
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
	// finished when it closes, only when its release is published.
	const classification = epic_classify.classify_children(
		snapshot.children,
		epic_cross_repo.resolve_cross_repo,
		running,
	)

	return epic_report.build_result(classification, anomalies, paths)
}

// A refusal: the reason on stderr, where every other explanation this command prints goes.
function refuse(reason: string): number {
	console.error(reason)

	return FAILURE_EXIT_CODE
}

// The verdict as it applies to *this* repository. `run` never reaches a caller here: it means some
// other repository has work, which for this session is something to wait on rather than a state its
// loop has a branch for. The whole-run timeout is what bounds that wait.
function repo_verdict(verdict: LaneOffer['verdict']): LaneOffer['verdict'] {
	return verdict === 'run' ? 'wait' : verdict
}

// The confirmed candidates' numbers, one per line, or the verdict that stands in their place when
// there was no free lane or the relations listing withheld every one of them.
// Standard output carries numbers or a verdict and nothing else, so
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
// whichever epic those belong to, counted rather than excluded. The invariant is per *repository* rather than per epic, and it is a
// ceiling on how many children run there at once rather than a lock on the whole checkout.
//
// Asked only when there *is* a candidate: consulted on `stop` or `complete` too, an unrelated
// `in-progress` issue would turn a finished epic into a permanent `wait`, and neither of those
// verdicts is about to start anything. It also never reaches a third party's tracker, since a child
// in a repository with another owner is refused before it is read.
//
// **A read that failed answers `wait` too** — never a child, and not an error either
// (`epic-busy.ts` records why both wrong answers are wrong). **So does a listing that was cut
// short**: the page ceiling bounds this listing as well, and a short
// listing with no visible holder is not "nothing is running".
//
// One pool per named epic, in the order they were named. Nothing below this line knows what an epic
// is (`epic-lane-offer.ts` records why), so the whole cost of running several of them is here: build
// the pools, and let the scheduler spend the free lanes across them.
async function offer_children(
	views: ReadonlyArray<EpicView>,
	request: LaneRequest,
): Promise<number> {
	const pools = epic_next_views.pools_of(views, request.repo)

	return report_offer(await epic_lane_offer.offer_for_repo(pools, request))
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
// graph is broken would hand a caller work the anomaly says must not start. **One broken graph
// refuses the whole answer**, whichever epic it belongs to — handing out another epic's child in the
// same breath would let an unattended run walk past a graph a person has to look at.
async function report_single(
	views: ReadonlyArray<EpicView>,
	request: LaneRequest,
): Promise<number> {
	const broken = epic_next_views.error_view(views)

	if (broken !== undefined) {
		return refuse(epic_next_views.format_view(broken, views.length > ONE_EPIC, request.repo))
	}

	const has_candidate = views.some(
		(view) => epic_report.candidates_for_repo(view.result, request.repo).length > NO_CHILDREN,
	)

	if (!has_candidate) {
		console.error(`No runnable child in ${request.repo}.`)
		console.info(repo_verdict(epic_next_views.combined_verdict(views)))

		return SUCCESS_EXIT_CODE
	}

	return await offer_children(views, request)
}

// The aggregate listing does not consult the repository-level exclusion — `--repo` is what asks a
// repository whether it is busy, and doing it here would be one listing per repository for a report
// nobody branches on. Said out loud rather than left implicit: this output names runnable children,
// and the `--repo` form may answer `wait` for the very same child.
function note_unchecked_exclusion(views: ReadonlyArray<EpicView>): void {
	if (epic_next_views.combined_verdict(views) === 'run') console.error(UNCHECKED_EXCLUSION)
}

// One block per epic, and the notice printed once for all of them rather than once each: it says
// what this listing does not check, which is the same sentence however many graphs it covers. The
// listing names each epic and its children as `#N`, linkified against the current repository so the
// output a run reads carries clickable references rather than bare ones.
function report_aggregate(views: ReadonlyArray<EpicView>, current_repo: string): number {
	note_unchecked_exclusion(views)

	const text = epic_next_views.aggregate_text(views, current_repo)

	if (epic_next_views.error_view(views) !== undefined) {
		console.error(text)

		return FAILURE_EXIT_CODE
	}

	console.info(issue_citation.linkify(text, current_repo))

	return SUCCESS_EXIT_CODE
}

// Named per epic where there is more than one to tell apart: the notice's own wording says "this
// epic", which is exact for a single one and says nothing at all about which of several.
function external_notice(view: EpicView, is_many: boolean): string {
	return is_many
		? `${epic_next_views.format_reference(view.reference)} ${EXTERNAL_NOTICE}`
		: EXTERNAL_NOTICE
}

function note_external(views: ReadonlyArray<EpicView>): void {
	const is_many = views.length > ONE_EPIC

	for (const view of views) {
		if (view.snapshot.has_external_children) console.error(external_notice(view, is_many))
	}
}

async function report(
	views: ReadonlyArray<EpicView>,
	request: LaneRequest | undefined,
	current_repo: string,
): Promise<number> {
	note_external(views)
	if (request !== undefined) return await report_single(views, request)

	return report_aggregate(views, current_repo)
}

// The checkout each repository's children would be run in comes from the workspace map. A
// repository absent from it is reported without a path rather than cloned.
//
// **Every epic is classified against the same reset**, not one reset each: `reset_reported` and
// `reset_publish_cache` are per *invocation*, so clearing them between epics would let the same
// blocker be warned about once per epic that tracks it.
async function report_epics(
	views: ReadonlyArray<EpicView>,
	options: NextOptions,
	current_repo: string,
): Promise<number> {
	if (options.repo === undefined) return await report(views, undefined, current_repo)

	const choice = await lane_capacity.lane_limit()
	if (choice.kind === 'problem') return refuse(choice.problem)

	return await report(
		views,
		{ repo: options.repo, limit: choice.limit, is_all_lanes: options.is_all_lanes ?? false },
		current_repo,
	)
}

// One view per named epic, classified against one shared registry read. `running` is every named
// epic's children unless a caller that runs more — `backlog:next` — passes its own set, so a blocker
// in another named epic waits rather than stops.
function views_of(
	reads: ReadonlyArray<EpicRead>,
	running = epic_outside_blocker.running_keys(reads.flatMap((read) => read.snapshot.children)),
): ReadonlyArray<EpicView> {
	const paths = repo_discovery.discover_repositories(PROJECT_ROOT)

	// One registry answer per repository per invocation. A polling `epicrun` calls this command
	// again each round, and a release that appeared in between has to be seen.
	epic_cross_repo.reset_publish_cache()
	epic_classify.reset_reported()

	return epic_next_views.settle_views(running, (settled) =>
		reads.map((read) => ({
			...read,
			running: settled,
			result: decide(read.snapshot, paths, settled),
		})),
	)
}

// What the read walk produced, or nothing when there is still work to report. A skipped epic is
// named on standard error only where some other epic survived: with none left, the notices *are* the
// refusal, which is exactly the line a single childless epic printed before several were allowed.
function refuse_reads(result: SnapshotReads): number | undefined {
	if (result.refusal !== undefined) return refuse(result.refusal)
	if (result.reads.length === NO_CHILDREN) return refuse(result.notices.join('\n'))

	for (const notice of result.notices) console.error(notice)

	return undefined
}

async function run_epics(options: NextOptions): Promise<number> {
	const references = options.references ?? []
	if (references.length === NO_CHILDREN) return refuse(USAGE)
	const current_repo = await git_gh_command.repo_get_name_with_owner()
	if (current_repo === undefined) return refuse(UNKNOWN_REPO)
	const result = await epic_next_read.read_snapshots(references, current_repo)
	const stopped = refuse_reads(result)

	return stopped ?? (await report_epics(views_of(result.reads), options, current_repo))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.references === undefined) {
		console.error(options.usage ?? USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_epics(options)
}

// `process.exitCode` rather than `process.exit()`, for the reason `scripts/cost-runtime/cost-cli.ts` records:
// the answer goes to standard output and a write to a pipe is asynchronous on macOS, so exiting can
// tear the process down before it drains. This command's contract is `answer=$(pnpm josh epic:next
// <E>)`, which is exactly that pipe.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const epic_next = {
	EXTERNAL_NOTICE,
	FOREIGN_EPIC,
	is_order_declared,
	repo_verdict,
	UNCHECKED_EXCLUSION,
	parse_options,
	refuse_reads,
	views_of,
	run_epics,
	decide,
	report,
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
