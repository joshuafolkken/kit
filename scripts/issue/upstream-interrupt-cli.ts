import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { shell_quote } from '#scripts/lib/shell-quote'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { issue_cite } from './issue-cite'
import { issue_file_cli } from './issue-file-cli'
import { issue_number_shape } from './issue-number-shape'
import { session_cite } from './session-cite'

// `josh upstream:interrupt <finder> "<title>" --repo <owner/repo> --body-file <path> [--blocks-finder]`
// — the stop `upstream-interrupt.md` prescribes for a defect in another package, in one call: the tree
// set aside, the upstream Issue filed, a backlink to it under `## Upstream issues` on the finder, the
// `confirmation` sent. The order is the one the backlink needs — it cites the filed reference, so the
// filing comes before it. A third-party target is Tier C: nothing is filed there, the finder gets the
// draft under `## Upstream candidate` instead, and the run stops the same way. An `unknown` party
// writes nothing at all. Each step prints one line; a failing step stops the rest and prints what to
// re-run.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const POSITIONAL_COUNT = 2
const BLOCKS_FINDER_FLAG = '--blocks-finder'
const USAGE = `Usage: josh upstream:interrupt <finder> "<title>" --repo <owner/repo> --body-file <path> [${BLOCKS_FINDER_FLAG}]`
const UNKNOWN_PARTY_MESSAGE =
	'✖ unknown party: the target is not known to be ours — check `pnpm josh repo:party <owner/repo>` and ask before writing.'
const OPTIONS = {
	repo: { type: 'string' },
	'body-file': { type: 'string' },
	'blocks-finder': { type: 'boolean' },
} as const
const RECOVERY = 'If this did not arrive, the finder issue carries the same record.'
const RECOMMENDED = 'Wait for the upstream fix'
const NOTIFY_COMMAND = 'pnpm josh notify --task-type confirmation'
const ALTERNATIVES = ['Defer the upstream issue and resume the finder now']

interface Interrupt {
	finder: string
	title: string
	repo: string
	body_file: string
	is_blocking_finder: boolean
}

interface Positionals {
	finder: string
	title: string
}

function positionals_of(positionals: ReadonlyArray<string>): Positionals | undefined {
	const [finder, title] = positionals

	if (finder === undefined || title === undefined) return undefined
	const is_shaped =
		positionals.length === POSITIONAL_COUNT && issue_number_shape.is_issue_number(finder)

	return is_shaped ? { finder, title } : undefined
}

function parse(argv: ReadonlyArray<string>): Interrupt | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined
	const { repo, 'body-file': body_file, 'blocks-finder': is_blocking_finder } = parsed.values
	const named = positionals_of(parsed.positionals)

	if (named === undefined || repo === undefined || body_file === undefined) return undefined

	return { ...named, repo, body_file, is_blocking_finder: is_blocking_finder === true }
}

function stash_message(interrupt: Interrupt): string {
	return `upstream-interrupt: paused ${issue_cite.plain(interrupt.finder)}`
}

function blocks_finder_flag(interrupt: Interrupt): ReadonlyArray<string> {
	return interrupt.is_blocking_finder ? [BLOCKS_FINDER_FLAG] : []
}

function command_of(interrupt: Interrupt): string {
	const words = [
		'pnpm josh upstream:interrupt',
		interrupt.finder,
		shell_quote.single_quoted(interrupt.title),
		`--repo ${shell_quote.word(interrupt.repo)}`,
		`--body-file ${shell_quote.word(interrupt.body_file)}`,
	]

	return [...words, ...blocks_finder_flag(interrupt)].join(' ')
}

function stopped(step: string, reason: string, rerun: string): boolean {
	console.error(`✖ upstream:interrupt stopped at ${step}: ${reason} — re-run: \`${rerun}\``)

	return false
}

async function stash(interrupt: Interrupt): Promise<boolean> {
	const message = stash_message(interrupt)

	try {
		const verdict = await stash_push_cli.set_aside({ message, dir: undefined })

		console.info(session_cite.text(`stash: ${verdict} "${message}"`))

		return true
	} catch (error) {
		return stopped('stash', error_text.message_of(error), command_of(interrupt))
	}
}

// `--found-during` names the finder to `issue:file`, so `--blocks-finder` records it — not the lane or
// branch Issue — as blocked, and the filing cap counts against it.
function filing_argv(interrupt: Interrupt): ReadonlyArray<string> {
	const argv = [interrupt.title, '--body-file', interrupt.body_file, '--route', 'interrupt']
	const finder = ['--found-during', interrupt.finder]

	return [...argv, '--repo', interrupt.repo, ...finder, ...blocks_finder_flag(interrupt)]
}

// The filed Issue as `owner/repo#N`, the qualified form the backlink heading requires. A refused
// filing has printed its refusals, and re-running the whole command is safe: the stash finds the tree
// already clean.
async function file(interrupt: Interrupt): Promise<string | undefined> {
	const url = await issue_file_cli.file_issue(filing_argv(interrupt))
	const target = github_issue_url.parse(url)

	if (target === undefined) {
		stopped('file', 'the filing refused (above)', command_of(interrupt))

		return undefined
	}

	console.info(`file: ${String(url)}`)

	return issue_cite.plain(target.issue_number, target.name_with_owner)
}

function resume_line(interrupt: Interrupt): string {
	return `Resume with \`pnpm josh stash:pop "${stash_message(interrupt)}"\`.`
}

function backlink_body(interrupt: Interrupt, reference: string): string {
	const reason = `${issue_cite.plain(interrupt.finder)} stopped on this upstream defect; its work is stashed.`

	return `## Upstream issues\n\n- ${reference}\n\n${reason} ${resume_line(interrupt)}`
}

function candidate_of(interrupt: Interrupt, draft: string): string {
	const reason = `Not filed: \`${interrupt.repo}\` is third-party (Tier C) — a person posts the draft below.`

	return `## Upstream candidate\n\n${reason} ${resume_line(interrupt)}\n\n### ${interrupt.title}\n\n${draft}`
}

async function candidate_body(interrupt: Interrupt): Promise<string | undefined> {
	try {
		return candidate_of(interrupt, await readFile(interrupt.body_file, 'utf8'))
	} catch (error) {
		stopped('draft', error_text.message_of(error), command_of(interrupt))

		return undefined
	}
}

// A step that failed after the stash is re-run on its own, so its body is kept in a file the printed
// command reads — no shell evaluates it.
async function saved(body: string): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), 'upstream-interrupt-'))
	const file_path = path.join(directory, 'body.md')

	await writeFile(file_path, body)

	return file_path
}

// The body is copied out of the tree before the stash: `stash:push` sets untracked files aside, so a
// body written in the checkout would be gone before the filing reads it. Every later step, and the
// printed re-run, reads the copy.
async function kept_body(interrupt: Interrupt): Promise<Interrupt | undefined> {
	try {
		const body_file = await saved(await readFile(interrupt.body_file, 'utf8'))

		return { ...interrupt, body_file }
	} catch (error) {
		stopped('body', error_text.message_of(error), command_of(interrupt))

		return undefined
	}
}

async function comment(interrupt: Interrupt, body: string): Promise<boolean> {
	try {
		console.info(`comment: ${await git_gh_command.issue_comment(interrupt.finder, body)}`)

		return true
	} catch (error) {
		const rerun = `pnpm josh issue:comment ${interrupt.finder} --body-file ${await saved(body)}`

		return stopped('comment', error_text.message_of(error), rerun)
	}
}

async function notify(interrupt: Interrupt, body: string): Promise<boolean> {
	const is_sent = await telegram_notify.confirm({
		issue_title: interrupt.title,
		body,
		recovery: RECOVERY,
		recommended: `${RECOMMENDED}, then: ${resume_line(interrupt)}`,
		alternatives: ALTERNATIVES,
	})

	if (!is_sent) {
		const flags = `--body-file ${await saved(body)} --recommended '${RECOMMENDED}'`

		return stopped('notify', 'the confirmation was not sent', `${NOTIFY_COMMAND} ${flags}`)
	}

	console.info('notify: confirmation sent')

	return true
}

async function first_party(interrupt: Interrupt): Promise<boolean> {
	const reference = await file(interrupt)

	if (reference === undefined) return false
	const body = backlink_body(interrupt, reference)

	return (await comment(interrupt, body)) && (await notify(interrupt, body))
}

async function third_party(interrupt: Interrupt): Promise<boolean> {
	const body = await candidate_body(interrupt)

	if (body === undefined) return false

	return (await comment(interrupt, body)) && (await notify(interrupt, body))
}

async function interrupt_by_party(interrupt: Interrupt): Promise<boolean> {
	const party = repo_party.classify(
		repo_party.current_owner(),
		repo_party.target_owner(interrupt.repo),
	)

	if (party === repo_party.UNKNOWN) {
		console.error(UNKNOWN_PARTY_MESSAGE)

		return false
	}

	const kept = await kept_body(interrupt)

	if (kept === undefined || !(await stash(kept))) return false

	return party === repo_party.FIRST_PARTY ? await first_party(kept) : await third_party(kept)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const interrupt = parse(argv)

	if (interrupt === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return (await interrupt_by_party(interrupt)) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const upstream_interrupt_cli = { run }

export { upstream_interrupt_cli }
