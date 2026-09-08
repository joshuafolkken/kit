import {
	GH_REQUEST_TIMEOUT_MESSAGE,
	git_gh_exec,
	type GhApiRequest,
} from '#scripts/git/git-gh-exec'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { GATE_TARGETS } from '#scripts/verification-gate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_run, type StepResult } from './propagate-run'
import { propagate_steps } from './propagate-steps'
import type { PropagateTarget } from './propagate-targets'

// The spawns are replaced, the module's own constants are not: `GH_REQUEST_TIMEOUT_MESSAGE` is
// asserted below and a test-local copy of it would assert nothing (`CLAUDE.md` → "No clones").
vi.mock('#scripts/git/git-gh-exec', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	git_gh_exec: { exec_gh_api: vi.fn(), exec_gh_api_sync: vi.fn() },
}))

const mocked_api_sync = vi.mocked(git_gh_exec.exec_gh_api_sync)

const KIT = '@joshuafolkken/kit'
const APP_KIT = '@joshuafolkken/app-kit'
const VERSION = '1.111.0'
const LATEST = 'latest'
const ADOPT_ORIGIN = 'Opened by `josh adopt` in this repository.'
const TARGET: PropagateTarget = {
	repo: 'joshuafolkken/app-kit',
	path: '/Users/example/Development/app-kit',
	state: 'ready',
}

const ISSUE_URL = `https://github.com/${TARGET.repo}/issues/42`
const CONSUMER_ISSUES_PATH = `repos/${TARGET.repo}/issues`
const HTML_URL_FILTER = '.html_url'
const MISSING_CHECKOUT = '/nonexistent-propagate-consumer'
const REFUSAL =
	'gh: Validation Failed (HTTP 422)\n{"message":"Issues are disabled for this repository"}'

beforeEach(() => {
	vi.clearAllMocks()
	mocked_api_sync.mockReturnValue(ISSUE_URL)
})

// What a refused write throws: `to_gh_error` puts gh's one-line stderr summary ahead of the JSON
// body REST wrote to stdout, on separate lines.
function refuse_the_request(): void {
	mocked_api_sync.mockImplementation(() => {
		throw new Error(REFUSAL)
	})
}

function issue_request(): GhApiRequest {
	const request = mocked_api_sync.mock.calls[0]?.[0]
	if (request === undefined) throw new Error('gh api was never called')

	return request
}

// joshuafolkken/kit#1042: this was the last `gh <noun> <verb>` spawn in kit's own code. `gh issue
// create` goes through GraphQL, which a cloud session is answered 403 for, so propagation could not
// open the consumer's issue at all from one — while the REST endpoint below is served normally.
describe('propagate_steps.open_issue — what it asks GitHub for', () => {
	it('posts to the consumer repository issue collection over REST', () => {
		propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(issue_request()).toMatchObject({
			path: CONSUMER_ISSUES_PATH,
			jq_filter: HTML_URL_FILTER,
		})
	})

	// The body is multi-line markdown. Sending it as JSON over stdin is what keeps it independent of
	// shell quoting, and asserting it here is what would fail if it were spelled out as an argument.
	it('carries the multi-line body as JSON rather than as an argument', () => {
		propagate_steps.open_issue(TARGET, KIT, VERSION)
		const body = issue_request().body ?? ''

		expect(JSON.parse(body)).toStrictEqual({
			title: propagate_steps.issue_title(KIT, VERSION),
			body: propagate_steps.issue_body(KIT, VERSION),
		})
		expect(propagate_steps.issue_body(KIT, VERSION)).toContain('\n')
	})

	// One write layer: the request is the one `git_gh_issue_write` builds for every issue creation,
	// not a second description of the same write (`CLAUDE.md` → "No clones").
	it('builds its request through the shared issue-creation request', () => {
		propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(issue_request()).toStrictEqual(
			git_gh_issue_write.issue_create_request({
				title: propagate_steps.issue_title(KIT, VERSION),
				body: propagate_steps.issue_body(KIT, VERSION),
				repo: TARGET.repo,
			}),
		)
	})
})

// The return contract is what `issue_step` and `parse_issue_number` read, and `josh git` derives the
// branch name and the `closes #N` line from the number in it — so the shape had to survive the
// switch unchanged.
describe('propagate_steps.open_issue — the outcome it answers', () => {
	it('answers the new issue URL, which still yields the number', () => {
		const outcome = propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(outcome).toStrictEqual({ url: ISSUE_URL })
		expect(propagate_steps.parse_issue_number(outcome.url ?? '')).toBe('42')
	})

	// A refused request states its reason instead of throwing: the sequence reports the step as
	// failed, and a missing scope, disabled issues and a repository that does not exist are three
	// different reasons the report has to be able to name.
	it('answers gh reason rather than throwing when the request is refused', () => {
		refuse_the_request()

		const outcome = propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(outcome.url).toBeUndefined()
		expect(outcome.detail).toContain('Issues are disabled')
	})

	// The run's report is one line per consumer, and the failure reason has the "changes left
	// uncommitted" warning appended to its end — so a reason spanning two lines would print raw JSON
	// as a second line and hide that warning behind it. `to_gh_error` puts the stderr summary and the
	// JSON body on separate lines, and both are kept (joshuafolkken/kit#1029).
	it('folds gh two-stream reason onto one line without losing either half', () => {
		refuse_the_request()

		const { detail } = propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(detail).not.toContain('\n')
		expect(detail).toContain('Validation Failed (HTTP 422)')
	})

	// joshuafolkken/kit#1065: this step is the one propagation step that does not go through
	// `spawn_step`, so it never carried `STEP_TIMEOUT_MS` and a hung `gh` blocked the single-threaded
	// runner forever — no later consumer was processed at all. The budget now lives on the shared REST
	// entry (`GH_REQUEST_TIMEOUT_MS`, asserted in `git-gh-exec-sync.test.ts`); what this asserts is the
	// half that belongs here: the step **reports** the timeout as a failed write rather than answering
	// as though the issue had been opened.
	it('reports a timed-out write as a failed step naming the timeout', () => {
		mocked_api_sync.mockImplementation(() => {
			throw new Error(`${GH_REQUEST_TIMEOUT_MESSAGE}: Command timed out`)
		})

		const outcome = propagate_steps.open_issue(TARGET, KIT, VERSION)

		expect(outcome.url).toBeUndefined()
		expect(outcome.detail).toContain(GH_REQUEST_TIMEOUT_MESSAGE)
	})
})

describe('propagate_steps.parse_issue_number', () => {
	it('reads the number gh prints as the new issue URL', () => {
		expect(
			propagate_steps.parse_issue_number('https://github.com/joshuafolkken/app-kit/issues/42\n'),
		).toBe('42')
	})

	it('returns nothing when gh printed something else', () => {
		expect(propagate_steps.parse_issue_number('could not create issue')).toBeUndefined()
	})

	it('returns nothing for empty output', () => {
		expect(propagate_steps.parse_issue_number('')).toBeUndefined()
	})
})

describe('propagate_steps.issue_title', () => {
	// `josh git` derives the branch name and the `closes #N` line from this argument, so the title
	// has to be a plain one-line English string.
	it('names the package and the exact version being carried', () => {
		expect(propagate_steps.issue_title(KIT, VERSION)).toBe(`Upgrade ${KIT} to ${VERSION}`)
	})

	it('produces a single line', () => {
		expect(propagate_steps.issue_title(KIT, VERSION)).not.toContain('\n')
	})
})

describe('propagate_steps.describe_step', () => {
	it('touches nothing and reports the step as describable', () => {
		expect(propagate_steps.describe_step(TARGET, propagate_run.STEP_SYNC).is_ok).toBe(true)
	})
})

describe('propagate_steps.sync_command', () => {
	it('runs the consumer own CLI, never this checkout', () => {
		expect(propagate_steps.sync_command(propagate_steps.JOSH_BIN)).toEqual(['pnpm', 'josh', 'sync'])
	})

	// `@joshuafolkken/app-kit` syncs with `josh-app`. A sync spelled `josh` for every toolkit would
	// leave app-kit's managed files behind (joshuafolkken/kit#1085).
	it('spells the sync with the toolkit own CLI', () => {
		expect(propagate_steps.sync_command('josh-app')).toEqual(['pnpm', 'josh-app', 'sync'])
	})
})

describe('propagate_steps.STEP_COMMANDS', () => {
	// The four checks used to be re-chained here as a string. They are now single-sourced in
	// `josh gate` (joshuafolkken/kit#914), so the coverage is asserted against that definition —
	// a check added to the gate reaches the consumer-side verification without a second edit.
	it('runs the whole gate, not only the type check', () => {
		expect(propagate_steps.VERIFY_SCRIPT).toBe(`pnpm josh ${GATE_COMMAND}`)

		expect(GATE_TARGETS).toEqual(['lint', 'check', 'cspell:dot', 'test:unit'])
	})

	// A step that failed the gate must never reach the pull request, so the verification has to be
	// one command whose failure ends the sequence. `josh gate` runs every check even when one fails
	// — reporting all of them — and still exits non-zero, which is what stops the sequence.
	it('verifies with a single command whose failure stops the sequence', () => {
		expect(propagate_steps.VERIFY_SCRIPT).not.toContain('&&')
	})
})

// The exact version is the whole point of the publish wait: `josh version:upgrade` installs the
// registry's latest, so a release published while the run was in flight would be the one every
// consumer received instead.
describe('propagate_steps.upgrade_command', () => {
	it('pins the exact version that was waited for', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain(`${KIT}@${VERSION}`)
	})

	it('never asks for latest', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).not.toContain('latest')
	})

	it('installs into the consumer own dev dependencies', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain('pnpm add -D')
	})

	it('repairs the lockfile the way kit own upgrade does', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain('fix-gh-packages')
	})
})

describe('propagate_steps.precheck_step', () => {
	it('refuses a consumer whose checkout is not a git repository', () => {
		const result = propagate_steps.precheck_step(
			{ ...TARGET, path: MISSING_CHECKOUT },
			propagate_run.STEP_PRECHECK,
		)

		expect(result.is_ok).toBe(false)
	})
})

// A command that fails to *spawn* leaves execa with no streams at all, and the failure attribution
// reads them. Thrown from here the error escapes the whole run — every consumer after this one goes
// unattempted and the end-of-run report is never printed (joshuafolkken/kit#1417).
function run_pull_request_step(): StepResult {
	const target: PropagateTarget = { ...TARGET, path: MISSING_CHECKOUT }
	const runner = propagate_steps.create_step_runner({
		releases: [{ package_name: KIT, version: VERSION, bin_name: 'josh' }],
		origin: propagate_steps.PROPAGATE_ORIGIN,
	})

	runner(target, propagate_run.STEP_ISSUE)

	return runner(target, propagate_run.STEP_PR)
}

describe('propagate_steps.create_step_runner — a pull-request step that could not spawn', () => {
	it('reports the failure rather than throwing out of the run', () => {
		expect(() => run_pull_request_step()).not.toThrow()
	})

	it('still names the step as failed', () => {
		expect(run_pull_request_step().is_ok).toBe(false)
	})
})

// `josh adopt` carries every toolkit a consumer has installed, so the upgrade and the sync repeat
// per release while everything else happens once (joshuafolkken/kit#1085). The step order itself is
// unchanged, which is what keeps the two commands on one sequence.
const PLAN = {
	releases: [
		{ package_name: KIT, version: LATEST, bin_name: 'josh' },
		{ package_name: APP_KIT, version: LATEST, bin_name: 'josh-app' },
	],
	origin: ADOPT_ORIGIN,
}

describe('propagate_steps — a plan repeats the upgrade and the sync per release', () => {
	it('upgrades once per toolkit', () => {
		const commands = propagate_steps.upgrade_commands(PLAN).map((one) => one.command.join(' '))

		expect(commands).toHaveLength(2)
		expect(commands[0]).toContain(`${KIT}@${LATEST}`)
		expect(commands[1]).toContain(`${APP_KIT}@${LATEST}`)
	})

	it('syncs once per toolkit, through each toolkit own CLI', () => {
		expect(propagate_steps.sync_commands(PLAN).map((one) => one.command)).toEqual([
			['pnpm', 'josh', 'sync'],
			['pnpm', 'josh-app', 'sync'],
		])
	})

	// The run's report is one line per target, so a failed step that said only `exit 1` would leave a
	// two-toolkit upgrade with nothing to act on.
	it('carries the package name so a failure can name which toolkit failed', () => {
		expect(propagate_steps.sync_commands(PLAN).map((one) => one.package_name)).toEqual([
			KIT,
			APP_KIT,
		])
	})
})

describe('propagate_steps — one issue names every release the plan carries', () => {
	it('names every toolkit in the one issue title', () => {
		expect(propagate_steps.plan_title(PLAN.releases)).toBe(
			`Upgrade ${KIT} and ${APP_KIT} to ${LATEST}`,
		)
	})

	it('keeps the title on one line, which josh git derives the branch name from', () => {
		expect(propagate_steps.plan_title(PLAN.releases)).not.toContain('\n')
	})

	it('names every toolkit in the one issue body, and says which command opened it', () => {
		const body = propagate_steps.plan_body(PLAN)

		expect(body).toContain(`\`${KIT}@${LATEST}\``)
		expect(body).toContain(`\`${APP_KIT}@${LATEST}\``)
		expect(body).toContain(ADOPT_ORIGIN)
	})

	// The generalization must leave a propagation run's own issue exactly as it was.
	it('reproduces the single-release title and body unchanged', () => {
		const single = [{ package_name: KIT, version: VERSION, bin_name: 'josh' }]

		expect(propagate_steps.plan_title(single)).toBe(propagate_steps.issue_title(KIT, VERSION))
		expect(
			propagate_steps.plan_body({ releases: single, origin: propagate_steps.PROPAGATE_ORIGIN }),
		).toBe(propagate_steps.issue_body(KIT, VERSION))
	})
})

describe('propagate_run.STEP_ORDER', () => {
	// Everything after the pre-check writes: the upgrade rewrites the lockfile, the sync overwrites
	// managed files. Refusing a dirty consumer afterwards would be refusing it too late.
	it('checks the working tree before anything writes to it', () => {
		expect(propagate_run.STEP_ORDER[0]).toBe(propagate_run.STEP_PRECHECK)
	})

	it('opens the issue before the pull request that closes it', () => {
		const order = propagate_run.STEP_ORDER

		expect(order.indexOf(propagate_run.STEP_ISSUE)).toBeLessThan(
			order.indexOf(propagate_run.STEP_PR),
		)
	})

	it('verifies before opening anything at all', () => {
		const order = propagate_run.STEP_ORDER

		expect(order.indexOf(propagate_run.STEP_VERIFY)).toBeLessThan(
			order.indexOf(propagate_run.STEP_ISSUE),
		)
	})

	// `josh git` leaves the consumer on the feature branch; the next run's pre-check would refuse it
	// for that, and the consumer would silently stop receiving releases.
	it('returns the consumer to its default branch last', () => {
		expect(propagate_run.STEP_ORDER.at(-1)).toBe(propagate_run.STEP_RETURN)
	})
})
