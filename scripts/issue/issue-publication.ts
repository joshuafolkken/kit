import { repo_party } from '#scripts/discovery/repo-party'
import type { EpicChild, IssueReference } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { epic_parse } from '#scripts/epic/epic-parse'
import { epic_validate } from '#scripts/epic/epic-validate'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_memo } from '#scripts/gh/git-gh-issue-memo'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { has_label_name, PLANNED_LABEL } from './issue-labels'
import { issue_number_shape } from './issue-number-shape'
import { issue_publication_state } from './issue-publication-state'
import { session_cite } from './session-cite'

interface PreparedChild {
	child: EpicChild
	blockers: ReadonlyArray<IssueReference>
}

async function read_child(number: number, repo: string): Promise<PreparedChild> {
	return {
		child: await epic_live.child(number, repo),
		blockers: await epic_live.blockers(number, repo),
	}
}

function has_unrecorded_dependencies(prepared: PreparedChild, epic: EpicChild): boolean {
	const { child, blockers } = prepared
	const required = epic_parse
		.parse_dependency_links(epic.body)
		.filter((link) => link.blocked === child.number)

	return required.some((link) =>
		blockers.every((blocker) => blocker.repo !== child.repo || blocker.number !== link.blocker),
	)
}

function validate_child(prepared: PreparedChild, epic: EpicChild): void {
	const { child } = prepared
	if (!issue_publication_state.is_pending(child.body)) return

	const cited = session_cite.issue(child.number)
	const is_planned = child.state === 'OPEN' && has_label_name(child.labels, PLANNED_LABEL)

	if (!is_planned) {
		throw new Error(`Publication withheld: ${cited} needs its recorded plan`)
	}

	if (has_unrecorded_dependencies(prepared, epic)) {
		throw new Error(`Publication withheld: ${cited} has unrecorded dependencies`)
	}

	issue_publication_state.labels_of(child.body, child.labels)
}

async function publish_child({ child }: PreparedChild): Promise<void> {
	const body = child.body ?? ''
	if (!issue_publication_state.is_pending(body)) return

	try {
		await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.issue_api_path(String(child.number), child.repo),
			method: 'PATCH',
			body: JSON.stringify({
				body: issue_publication_state.public_body(body),
				labels: issue_publication_state.labels_of(body, child.labels),
			}),
		})
	} finally {
		git_gh_issue_memo.forget()
	}
}

function require_first_party(repo: string): void {
	const party = repo_party.classify(repo_party.current_owner(), repo_party.target_owner(repo))

	if (party !== repo_party.FIRST_PARTY) {
		throw new Error('Publication requires a known first-party tracker')
	}
}

// Validate the entire batch before the first atomic body+labels publication. An interrupted batch
// can be retried: published children are skipped, pending children still require all checks.
async function publish(epic_number: number, repo: string): Promise<void> {
	require_first_party(repo)
	const epic = await epic_live.child(epic_number, repo)
	const checks = epic_validate.validate_epic({ ...epic, body: epic.body })

	if (!epic_validate.is_epic_valid(checks)) {
		throw new Error('Publication withheld: epic is incomplete')
	}

	const children = await Promise.all(
		epic_parse
			.parse_task_list_issue_numbers(epic.body)
			.map(async (number) => await read_child(number, repo)),
	)
	for (const child of children) validate_child(child, epic)

	for (const child of children) {
		// eslint-disable-next-line no-await-in-loop -- each atomic publish can be retried independently
		await publish_child(child)
	}
}

function epic_number_of(argv: ReadonlyArray<string>): string | undefined {
	const parsed = cli_flags.arguments_of(argv, { publish: { type: 'string' } })
	if (parsed === undefined || parsed.positionals.length > 0) return undefined
	const number = parsed.values.publish

	if (number === undefined || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(number)) {
		return undefined
	}

	return number
}

async function publish_here(number: string): Promise<void> {
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) throw new Error('Cannot resolve publication repository')
	await publish(Number(number), repo)
	console.info(`Published prepared children of ${session_cite.issue(number)}`)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const number = epic_number_of(argv)
	if (number === undefined) return 1

	try {
		await publish_here(number)

		return 0
	} catch (error) {
		console.error(error_text.message_of(error))

		return 1
	}
}

const issue_publication = { publish, run }

export { issue_publication }
