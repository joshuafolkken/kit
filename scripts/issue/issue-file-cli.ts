import { repo_party } from '#scripts/discovery/repo-party'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { cli_body } from '#scripts/josh/cli-body'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold_member } from '#scripts/run/hold/run-hold-member'
import { split_direction } from '#scripts/split/split-direction'
import { split_resolution } from '#scripts/split/split-resolution'
import { issue_cite } from './issue-cite'
import { issue_classification } from './issue-classification'
import { issue_file, type FileArguments } from './issue-file'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_deferral } from './issue-file-deferral'
import { issue_file_fold } from './issue-file-fold'
import { issue_file_interrupt } from './issue-file-interrupt'
import { issue_file_pass, type Filing } from './issue-file-pass'
import { issue_file_worker } from './issue-file-worker'
import { has_label_name, has_parked_label, RUN_SOLO_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'
import { issue_publication_state } from './issue-publication-state'
import { issue_release_cli } from './issue-release-cli'
import { issue_run_verdict } from './issue-run-verdict'
import type { ScoutOutcome } from './issue-scout-cli'
import { issue_state_cli } from './issue-state-cli'
import { session_cite } from './session-cite'

// `josh issue:file "<title>" --body-file <path> [--route <route>] [--label <name>]…
// [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok]
// [--release] [--blocks-finder] [--check]` — file an Issue with every filing step run: the third-party
// refusal, the filing cap per origin, the fold question against the run's earlier filings and a split
// child the kept Issue depends on (`split-direction.ts`), each ending the filing on its own; then one pass printing every refusal at once (`issue-file-pass.ts`) —
// the body lint, the size estimate against the split guide, the start condition a measurement
// follow-up owes, the `## Origin` check for another repository, the `auto-ok` decision with the run
// label it owes, the start condition read as a pull request, the WIP cap count and the duplicate
// scout; then the missing workflow labels created, the create call carrying every label, a blocking
// interrupt's finder recorded as blocked by it, declared parks recorded through the shared epic
// recorder, the release link on `--release`, and `epic:bundle`.
// `--check` stops before the labels and the create call, so nothing is written to GitHub.
// A direct `gh api …/issues` filing is refused by the `direct-filing` delivered rule and pointed here.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh issue:file "<title>" --body-file <path> [--route <tier-a|split|interrupt|review-cap>] [--label <name>]… [--defect yes|no|unknown] [--verification yes|no|unknown] [--every-run yes|no|unknown] [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok] [--release] [--blocks-finder] [--check]'
const CHECK_CLEAR_MESSAGE = 'check: every filing step passed — nothing filed (`--check`).'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote`, so the filing has no repository to compare against — check `gh auth status`.'
const THIRD_PARTY_MESSAGE =
	'✖ third-party target: a tracker we do not own is Tier C — draft the Issue for a person to post instead (`CLAUDE.md` → "Third-party repositories are Tier C").'
const UNKNOWN_PARTY_MESSAGE =
	'✖ unknown party: the owner of this session or of the target could not be read (`git remote` / `--repo`), so the target is not known to be ours — check `pnpm josh repo:party`.'
const { GH_REPO_VARIABLE } = issue_file_pass

// An owner that cannot be read is refused like a third party — stricter than the `third-party-write`
// hook, which stays silent on `unknown`: a filing is admitted only when the target is known to be ours.
function party_refusal(target: string): string | undefined {
	const party = repo_party.classify(repo_party.current_owner(), repo_party.target_owner(target))

	if (party === repo_party.FIRST_PARTY) return undefined

	return party === repo_party.THIRD_PARTY ? THIRD_PARTY_MESSAGE : UNKNOWN_PARTY_MESSAGE
}

// `undefined` when the create call failed. `gh`'s standard error is captured into the thrown error
// rather than printed, so it is printed here — otherwise the filing fails with no reason given. A label
// the create applies is provisioned first, so it never arrives with a generated color.
async function create(filing: Filing, labels: ReadonlyArray<string>): Promise<string | undefined> {
	repository_labels.ensure_labels(
		filing.target,
		issue_file_worker.label_definitions(filing, labels),
	)
	const request = git_gh_issue_write.issue_create_request({
		title: filing.args.title,
		...issue_publication_state.creation(
			filing.body,
			labels,
			filing.args.is_prepared === true || has_label_name(labels, 'route:split'),
		),
		repo: filing.target,
	})

	try {
		return await git_gh_exec.exec_gh_api(request)
	} catch (error) {
		const reason = error_text.message_of(error)

		console.error(`✖ the create call failed: ${reason}`)

		return undefined
	}
}

function issue_number_of(url: string): number {
	return Number(github_issue_url.parse(url)?.issue_number)
}

// `--release`: the filed Issue blocks the target's release Issue. Reported,
// never failed, for the reason `place` gives. The re-run hint names the target through `GH_REPO`:
// `issue:release` links in the repository `gh` resolves, which is not the target on a `--repo` filing.
async function link_release(url: string, filing: Filing): Promise<void> {
	if (!filing.args.is_release) return
	const issue_number = issue_number_of(url)
	const is_linked =
		Number.isSafeInteger(issue_number) &&
		(await issue_release_cli.link(issue_number, filing.target))

	if (is_linked) return
	console.error(
		`⚠ the release link did not complete for ${url} — run \`${GH_REPO_VARIABLE}=${filing.target} pnpm josh issue:release <N>\`.`,
	)
}

// The Issue exists once `create` returns, so a failed placement is reported rather than failed: a
// non-zero exit would read as "not filed" and invite the second filing the scout exists to stop.
// The open listing trails the create call; `report_for` reads the new issue on its own when the
// listing does not show it yet.
async function place(url: string, target: string): Promise<void> {
	const issue_number = issue_number_of(url)
	const exit_code = Number.isSafeInteger(issue_number)
		? await epic_bundle_cli.report_for(issue_number, target)
		: FAILURE_EXIT_CODE

	if (exit_code !== SUCCESS_EXIT_CODE) {
		console.error(`⚠ epic:bundle did not answer for ${url} — run \`pnpm josh epic:bundle <N>\`.`)
	}
}

// Every filing lands on the run's event stream: this is the one filing path, so
// one append here reaches `run:board` from every route. A filing outside a run lands too, unmarked as
// the run's (`run_hold_member`), and the board counts only the marked ones; a lane's overrun
// investigation marks its own, which the board draws after 🔍; the append is best-effort, as every emit is.
async function emit_filed(
	reference: string,
	filing: Filing,
	labels: ReadonlyArray<string>,
	found_during: string | undefined,
): Promise<void> {
	const kind = run_event_filed.kind_of(labels)
	const is_run = await run_hold_member.is_run_member()
	const is_overrun = lane_child_marker.is_overrun()
	const { title } = filing.args
	const text = run_event_filed.text_of({ reference, kind, title, found_during, is_run, is_overrun })

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.FILED, text)
}

// The create has succeeded; report a recorder failure without inviting another filing.
async function record_park(issue: string, prerequisite: string): Promise<void> {
	try {
		const read = await issue_state_cli.read_issue(issue)
		if (read.kind !== 'state') throw new Error(`could not read park state: ${read.kind}`)
		if (read.state.state !== 'OPEN' || !has_parked_label(read.state.labels)) return
		const result = await epic_blocked_by.record({ issue, prerequisite, is_relation_only: true })

		console.info(
			`caused park ${session_cite.issue(issue)} blocked by ${session_cite.issue(prerequisite)}: ${result}`,
		)
	} catch (error) {
		console.error(
			`⚠ ${session_cite.issue(prerequisite)} is already filed; caused park ${session_cite.issue(issue)} dependency could not be recorded: ${error_text.message_of(error)}`,
		)
	}
}

async function record_parks(url: string, filing: Filing): Promise<void> {
	if (!issue_file.is_same_repository(filing.target, filing.current)) return
	const blocker = issue_number_of(url)

	if (!Number.isSafeInteger(blocker) || blocker <= 0) return

	for (const issue of issue_priority.parked_issues(filing.body)) {
		// eslint-disable-next-line no-await-in-loop -- each record may rewrite the same epic declaration
		await record_park(issue, String(blocker))
	}
}

async function record(url: string, filing: Filing, labels: ReadonlyArray<string>): Promise<void> {
	const number = String(issue_number_of(url))
	const reference = issue_cite.plain_for(
		'terminal',
		number,
		issue_file_fold.reference_prefix(filing.target, filing.current),
	)
	const found_during = await issue_file_fold.finder(filing.args.found_during)

	await emit_filed(reference, filing, labels, found_during)
	await issue_file_deferral.note_finder({
		found_during: filing.args.found_during,
		reference,
		title: filing.args.title,
		current: filing.current,
	})
	await split_resolution.record_child({ route: filing.args.route, found_during, child: url })
	await issue_file_interrupt.block_finder({
		route: filing.args.route,
		is_blocking_finder: filing.args.is_blocking_finder,
		found_during,
		blocker: issue_number_of(url),
		is_here: issue_file.is_same_repository(filing.target, filing.current),
	})
	await record_parks(url, filing)
}

// Once created, a comment failure warns rather than inviting a duplicate filing.
async function record_solo(
	url: string,
	filing: Filing,
	labels: ReadonlyArray<string>,
): Promise<void> {
	if (!has_label_name(labels, RUN_SOLO_LABEL)) return
	const { answers = {} } = filing.args
	const body = issue_run_verdict.comment_with_answers(RUN_SOLO_LABEL, { ...answers, solo: true })

	try {
		await git_gh_command.issue_comment(String(issue_number_of(url)), body, filing.target)
	} catch (error) {
		console.error(
			`⚠ ${url} is already filed; could not record solo answers: ${error_text.message_of(error)}`,
		)
	}
}

async function send(filing: Filing, labels: ReadonlyArray<string>): Promise<string | undefined> {
	const url = await create(filing, labels)

	if (url === undefined) return undefined
	console.info(url)
	await record_solo(url, filing, labels)
	await record(url, filing, labels)
	await link_release(url, filing)
	await place(url, filing.target)

	return url
}

// The holds that end the filing before the one pass, read first: the filing cap reads the local event
// stream, the fold the stream and diff, the split direction the kept Issue's body on GitHub.
async function is_run_clear(filing: Filing): Promise<boolean> {
	const prefix = issue_file_fold.reference_prefix(filing.target, filing.current)

	return (
		split_resolution.is_split_clear(filing.args) &&
		(await issue_file_cap.is_cap_clear(filing.args.found_during)) &&
		(await issue_file_fold.is_fold_clear(prefix, filing.args)) &&
		(await split_direction.is_direction_clear(filing.args, filing.body))
	)
}

// The labels the create call carries once every step passed, or `undefined` once any refused — each
// refusal already printed.
async function admitted_labels(filing: Filing): Promise<ReadonlyArray<string> | undefined> {
	const party_problem = party_refusal(filing.target)

	if (party_problem !== undefined) {
		console.error(party_problem)

		return undefined
	}

	if (!(await is_run_clear(filing))) return undefined

	return await issue_file_pass.labels_in_one_pass(filing)
}

// `--check` creates nothing whatever the steps answer, so a filing routed here through `--batch` or
// `file_issue` never reaches GitHub either.
async function file(filing: Filing): Promise<string | undefined> {
	const labels = await admitted_labels(filing)

	if (labels === undefined || filing.args.is_check) return undefined

	return await send(filing, labels)
}

// `--check`: every step's verdict printed, exit 0 only when none refused.
async function check(filing: Filing): Promise<number> {
	if ((await admitted_labels(filing)) === undefined) return FAILURE_EXIT_CODE
	console.info(CHECK_CLEAR_MESSAGE)

	return SUCCESS_EXIT_CODE
}

async function filing_of(args: FileArguments): Promise<Filing | string> {
	const read = cli_body.read_result(args.body_file)

	if ('problem' in read) return `Could not read the body file ${args.body_file}: ${read.problem}`
	const body = issue_classification.with_release_classification(
		read.text,
		issue_file.labels_of(args, read.text),
	)
	const current = await git_gh_command.repo_get_name_with_owner()

	if (current === undefined) return UNKNOWN_REPO_MESSAGE

	return { args, body, target: args.repo ?? current, current }
}

// The filing `argv` names, or `undefined` once the usage or the body file refused it — printed.
async function parsed_filing(argv: ReadonlyArray<string>): Promise<Filing | undefined> {
	const args = issue_file.parse(argv)

	if (args === undefined) {
		console.error(USAGE)

		return undefined
	}

	const filing = await filing_of(args)

	if (typeof filing === 'object') return filing
	console.error(filing)

	return undefined
}

// The filed Issue's URL, or `undefined` once any step refused — every refusal already printed. The
// caller that sequences a filing (`upstream:interrupt`) reads the URL from here, not from stdout.
async function file_issue(
	argv: ReadonlyArray<string>,
	scouted?: ScoutOutcome,
): Promise<string | undefined> {
	const filing = await parsed_filing(argv)

	return filing === undefined
		? undefined
		: await issue_file_pass.with_repository_restored(async () => await file({ ...filing, scouted }))
}

// The scout `file_issue` would run, for `issue:file --batch` to run for every filing before the first.
async function scout(argv: ReadonlyArray<string>): Promise<ScoutOutcome | undefined> {
	const args = issue_file.parse(argv)
	const filing = args === undefined ? undefined : await filing_of(args)

	return typeof filing === 'object'
		? await issue_file_pass.with_repository_restored(
				async () => await issue_file_pass.scout_filing(filing),
			)
		: undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const filing = await parsed_filing(argv)

	if (filing === undefined) return FAILURE_EXIT_CODE

	return await issue_file_pass.with_repository_restored(async () => {
		if (filing.args.is_check) return await check(filing)

		return (await file(filing)) === undefined ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
	})
}

const issue_file_cli = {
	THIRD_PARTY_MESSAGE,
	UNKNOWN_PARTY_MESSAGE,
	file_issue,
	record,
	run,
	scout,
}

export { issue_file_cli }

export { type Filing } from './issue-file-pass'
