import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_cite_cli } from '#scripts/issue/issue-cite-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { telegram_test } from '#scripts/notify/telegram-test'
import type { CliValues } from '#scripts/notify/telegram-test-logic'
import { issue_citation } from '#scripts/rules/issue-citation'
import { stop_rules, type StopAction, type StopOutcome } from '#scripts/rules/stop-rules'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { run_hold_session } from '#scripts/run/hold/run-hold-session'

type NotifyAction = Extract<StopAction, { kind: 'notify' }>

// The `Stop` hook running the operations whose answer is fixed (joshuafolkken/kit#3919): the
// `confirmation` notify, the hold release and the citation lines, through the very calls
// `josh notify`, `josh run:release` and `josh issue:cite` make — in process, since three `pnpm`
// launches would spend most of the hook's 20-second budget. What each did reaches the person as a
// `systemMessage`; one that did not take falls back to the refusal it replaced (`stop_rules.fallback_reason`).

const SUCCESS_EXIT_CODE = 0
const NOTICE_SEPARATOR = '\n'
// The reply is the stop's reason, but a Telegram is read at a glance — its opening is enough.
const SUMMARY_CHARS = 600
// A `#N`, `owner/repo#N` or URL is a run of printable ASCII; a cut inside one would link the wrong Issue.
const TOKEN_CHAR = /^[!-~]$/u
const EMPTY_SUMMARY = 'The run stopped and is waiting for you.'

interface Settled {
	notices: ReadonlyArray<string>
	failure: string | undefined
}

// One action at a time — the order is the rule order.
const SEQUENTIAL = 1

// Where the run of token characters `text` ends with starts.
function token_start(text: string): number {
	let index = text.length

	while (index > 0 && TOKEN_CHAR.test(text.charAt(index - 1))) index -= 1

	return index
}

// Cut before linking, on a boundary that keeps every reference whole: the character past the cut shows
// whether the last token ran on, and a token that did is dropped rather than halved.
function summary_of(message: string): string {
	const trimmed = message.trim()
	if (trimmed === '') return EMPTY_SUMMARY
	if (trimmed.length <= SUMMARY_CHARS) return trimmed

	const overshoot = trimmed.slice(0, SUMMARY_CHARS + 1)
	const cut = overshoot.slice(0, Math.min(token_start(overshoot), SUMMARY_CHARS))

	return cut === '' ? trimmed.slice(0, SUMMARY_CHARS) : cut
}

// The held Issue's URL, or `undefined` for a `new` entry or a repository that cannot be read.
async function issue_url_of(issue: string): Promise<string | undefined> {
	if (issue === run_hold.UNNUMBERED_ISSUE) return undefined

	const slug = await git_gh_repo.repo_get_name_with_owner()

	return slug === undefined ? undefined : issue_cite.issue_url(slug, issue)
}

// The body is the reply's opening copied into a Telegram, so its bare `#N` are linked (`issue-citation.md`).
// The choices are the reply's own decision lines (joshuafolkken/kit#3961).
function notify_values(issue_url: string | undefined, action: NotifyAction): CliValues {
	const { recommended, alternative } = action.decision
	const values: CliValues = {
		'task-type': 'confirmation',
		body: session_cite.text(summary_of(action.message)),
		recommended,
		...(alternative !== undefined && { alternative: [alternative] }),
	}

	return issue_url === undefined ? values : { ...values, 'issue-url': issue_url }
}

// The send is stamped on the hold, so a later stop of the same pause does not announce it again.
async function mark_notified(): Promise<void> {
	const directory = await run_hold.worktree_directory()

	if (directory !== undefined) run_hold_session.mark_notified(run_hold.hold_path(directory))
}

async function notify(action: NotifyAction): Promise<string> {
	const issue_url = await issue_url_of(action.issue)

	await telegram_test.send_values(notify_values(issue_url, action))
	await mark_notified()

	return `📱 stop:guard sent the confirmation notify (${issue_url ?? action.issue}).`
}

async function release(issue: string): Promise<string | undefined> {
	const argv = issue === run_hold.UNNUMBERED_ISSUE ? ['--release'] : ['--release', issue]
	const code = await run_hold_cli.run(argv)

	return code === SUCCESS_EXIT_CODE ? '🔓 stop:guard released the run:hold record.' : undefined
}

// Every line or none: a citation with a number missing is the half-fix the refusal exists to avoid.
async function cite(references: ReadonlyArray<string>): Promise<string | undefined> {
	const cited = await issue_cite_cli.cite(issue_citation.cite_arguments(references))
	if (cited === undefined || cited.failures.length > 0) return undefined

	return ['Issue citations:', ...cited.lines].join(NOTICE_SEPARATOR)
}

// An action's line for the person, or `undefined` when it did not take.
async function run_action(action: StopAction): Promise<string | undefined> {
	if (action.kind === 'notify') return await notify(action)
	if (action.kind === 'release') return await release(action.issue)

	return await cite(action.references)
}

// **The hook's stdout is the decision envelope, so nothing else may reach it**: the reused calls report
// on stdout (`josh run:release`'s verdict token, the notify's sent line) and are sent to stderr instead.
type StreamWrite = typeof process.stdout.write

function set_stdout_write(stream_write: StreamWrite): void {
	process.stdout.write = stream_write
}

async function on_stderr<T>(work: () => Promise<T>): Promise<T> {
	const saved = { write: process.stdout.write.bind(process.stdout) }

	set_stdout_write(process.stderr.write.bind(process.stderr))

	try {
		return await work()
	} finally {
		set_stdout_write(saved.write)
	}
}

// A throw is an action that did not take, the same as one that answered it had failed.
async function attempt(action: StopAction): Promise<string | undefined> {
	try {
		return await run_action(action)
	} catch {
		return undefined
	}
}

function is_notice(notice: string | undefined): notice is string {
	return notice !== undefined
}

// In order, one at a time: the notify reports the hold the release then ends. The first failure is the
// one refused with, as the rule order put it first.
async function settle(actions: ReadonlyArray<StopAction>): Promise<Settled> {
	const notices = await on_stderr(
		async () => await bounded_pool.bounded_map(actions, SEQUENTIAL, attempt),
	)
	const failed = actions.find((_action, index) => notices[index] === undefined)

	return {
		notices: notices.filter((notice) => is_notice(notice)),
		failure: failed === undefined ? undefined : stop_rules.fallback_reason(failed),
	}
}

function joined(notices: ReadonlyArray<string>): string | undefined {
	return notices.length === 0 ? undefined : notices.join(NOTICE_SEPARATOR)
}

// A failure refuses only where the outcome allows it — never past the loop-breaker.
function settled_envelope(
	settled: Settled,
	is_blocking: boolean,
	lang: string,
): string | undefined {
	const notice = joined(settled.notices)

	if (is_blocking && settled.failure !== undefined) {
		return stop_rules.block_envelope(settled.failure, lang, notice)
	}

	return notice === undefined ? undefined : stop_rules.notice_envelope(notice)
}

// What the hook writes for one stop's outcome, or `undefined` for a stop that writes nothing.
async function envelope_of(outcome: StopOutcome, lang: string): Promise<string | undefined> {
	if (outcome.reason !== undefined) return stop_rules.block_envelope(outcome.reason, lang)

	const settled = await settle(outcome.actions)

	return settled_envelope(settled, outcome.blocks_on_failure, lang)
}

const stop_actions = { envelope_of, summary_of }

export { stop_actions }
