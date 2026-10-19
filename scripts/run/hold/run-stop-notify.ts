import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_pr_read } from '#scripts/gh/git-gh-pr-read'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { git_command } from '#scripts/git/git-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { stdout_on_stderr } from '#scripts/lib/stdout-on-stderr'
import { telegram_test } from '#scripts/notify/telegram-test'
import type { CliValues } from '#scripts/notify/telegram-test-logic'
import { run_stage } from '#scripts/run/run-stage'
import { run_hold_session } from './run-hold-session'

// The `confirmation` a `halfrun`, `needs-human-review` or `prrun` stop sends from `josh run:hold
// --halfrun-stop` / `--human-review-stop` / `--prrun-stop` (joshuafolkken/kit#4135, #4156): every line is fixed once the Issue, its title and the pull
// request are known, so it is composed here rather than copied from prose. The send goes through
// `josh notify`'s own call and is stamped on the hold, so the `Stop` hook's own confirmation
// (`stop-actions.ts`) finds the pause announced and does not send it again.
//
// **A failed send does not fail the stop**: the mark is written, and an unstamped hold is exactly what
// lets the `Stop` hook send the confirmation in its place.

const TITLE_PLACEHOLDER = '<title>'
const PR_PLACEHOLDER = '<pr-url>'
const HALFRUN = 'halfrun'
const PRRUN = 'prrun'
// Single quotes expand nothing, so a title stays one argument whatever it carries; its own `'` closes
// the quote, emits an escaped one and reopens.
const QUOTE = "'"

interface StopFacts {
	issue: string
	title: string | undefined
	issue_url: string | undefined
	pr_url?: string | undefined
}

interface Composed {
	values: CliValues
	title: string | undefined
}

function single_quoted(text: string): string {
	return QUOTE + text.replaceAll(QUOTE, String.raw`'\''`) + QUOTE
}

// Plain, not linked: every line is a command a person copies out of the Telegram.
function reference_of(facts: StopFacts): string {
	return issue_cite.plain(facts.issue)
}

function commit_title(facts: StopFacts): string {
	return single_quoted(`${facts.title ?? TITLE_PLACEHOLDER} ${reference_of(facts)}`)
}

function with_urls(values: CliValues, facts: StopFacts): CliValues {
	const with_issue =
		facts.issue_url === undefined ? values : { ...values, 'issue-url': facts.issue_url }

	return facts.pr_url === undefined ? with_issue : { ...with_issue, 'pr-url': facts.pr_url }
}

function halfrun_values(facts: StopFacts): CliValues {
	const title = commit_title(facts)
	const body = [
		'halfrun ready for manual verification',
		run_stage.next_line(HALFRUN, facts.issue),
		`Without an agent: pnpm josh git -y ${title} && pnpm josh followup ${title}`,
	].join('\n')
	const values: CliValues = {
		'task-type': 'confirmation',
		body,
		recommended: `Verify by hand, then prrun ${reference_of(facts)}`,
		alternative: [`fullrun ${reference_of(facts)}`],
	}

	return with_urls(values, facts)
}

// A `needs-human-review` stop resumes as `halfrun`'s does, so its next line is `halfrun`'s; the lane
// directory is named because the uncommitted work a person must look at lives only there.
function human_review_values(facts: StopFacts, directory: string): CliValues {
	const body = [
		'needs-human-review: implemented and gated, stopped before the commit',
		run_stage.next_line(HALFRUN, facts.issue),
		`Working tree: ${directory}`,
	].join('\n')
	const values: CliValues = {
		'task-type': 'confirmation',
		body,
		recommended: `Review the working tree, then prrun ${reference_of(facts)}`,
		alternative: [`fullrun ${reference_of(facts)}`],
	}

	return with_urls(values, facts)
}

function prrun_values(facts: StopFacts): CliValues {
	const body = [
		`prrun ready to merge: ${facts.pr_url ?? PR_PLACEHOLDER}`,
		run_stage.next_line(PRRUN, facts.issue),
		`After a manual merge, without an agent: pnpm josh followup ${commit_title(facts)}`,
	].join('\n')
	const values: CliValues = {
		'task-type': 'confirmation',
		body,
		recommended: `fullrun ${reference_of(facts)}`,
		alternative: ['Merge by hand, then pnpm josh followup'],
	}

	return with_urls(values, facts)
}

async function issue_facts(issue: string): Promise<StopFacts> {
	const slug = await git_gh_repo.repo_get_name_with_owner()
	const title = await git_gh_issue_read.issue_get_title(issue)

	return {
		issue,
		title,
		issue_url: slug === undefined ? undefined : issue_cite.issue_url(slug, issue),
	}
}

async function prrun_facts(issue: string): Promise<StopFacts> {
	const pr_url = await git_gh_pr_read.pr_get_url(await git_command.branch())

	return { ...(await issue_facts(issue)), pr_url }
}

// The title is passed with the values, so the send does not read it a second time.
async function send_composed(target: string, compose: () => Promise<Composed>): Promise<void> {
	const { values, title } = await compose()
	const titled = title === undefined ? values : { ...values, 'issue-title': title }

	await stdout_on_stderr.run(async () => {
		await telegram_test.send_values(titled)
	})
	run_hold_session.mark_notified(target)
}

// A `gh` read that fails is a send that did not happen, never a failed stop: the mark is already written.
async function send(target: string, compose: () => Promise<Composed>): Promise<void> {
	try {
		await send_composed(target, compose)
	} catch (error) {
		console.error(`⚠️  run:hold could not send the stop confirmation: ${String(error)}`)
	}
}

async function send_halfrun(target: string, issue: string): Promise<void> {
	await send(target, async () => {
		const facts = await issue_facts(issue)

		return { values: halfrun_values(facts), title: facts.title }
	})
}

async function send_prrun(target: string, issue: string): Promise<void> {
	await send(target, async () => {
		const facts = await prrun_facts(issue)

		return { values: prrun_values(facts), title: facts.title }
	})
}

async function send_human_review(target: string, issue: string): Promise<void> {
	await send(target, async () => {
		const facts = await issue_facts(issue)
		const directory = await git_command.repository_root()

		return { values: human_review_values(facts, directory), title: facts.title }
	})
}

const run_stop_notify = {
	halfrun_values,
	human_review_values,
	prrun_values,
	send_halfrun,
	send_human_review,
	send_prrun,
}

export { run_stop_notify }
