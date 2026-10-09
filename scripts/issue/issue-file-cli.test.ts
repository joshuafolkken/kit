import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_auto_ok } from './issue-auto-ok'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_release_cli } from './issue-release-cli'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'

// joshuafolkken/kit#2808: `josh issue:file` runs every filing step in order, and each refusal stops
// the filing before anything is sent. The network reads are stubbed at the namespaces the command
// calls, so what is asserted is the order and the request — never a real filing.

const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const FOREIGN = 'someone-else/project'
const OWNER = 'joshuafolkken'
const TITLE = 'Add a command that files an Issue'
const ISSUE_NUMBER = 2900
const ISSUE_URL = `https://github.com/${HERE}/issues/${String(ISSUE_NUMBER)}`
const DUPLICATE = 2801
const HELD_SCOUT = { report: 'Duplicates: 1', candidates: [DUPLICATE] }
const DISTINCT_HINT = `--distinct ${String(DUPLICATE)}`
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const VALID_BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'',
	'## 現象',
	'',
	'x',
	'',
	'## 期待結果',
	'',
	'y',
	'',
	'## 受け入れ条件',
	'',
	'- [ ] z',
	'',
].join('\n')

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-'))
const valid_path = path.join(work, 'valid.md')
const invalid_path = path.join(work, 'invalid.md')
const origin_path = path.join(work, 'origin.md')

writeFileSync(valid_path, VALID_BODY)
writeFileSync(invalid_path, '## 背景\n')
writeFileSync(origin_path, `${VALID_BODY}\n## Origin\n\n${HERE}#2808\n`)

const scout = vi.spyOn(issue_scout_cli, 'scout')
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const report_for = vi.spyOn(epic_bundle_cli, 'report_for')
const ensure_labels = vi.spyOn(repository_labels, 'ensure_labels')
const issue_list = vi.spyOn(git_gh_issue_list, 'issue_list')
const resolve_auto_ok = vi.spyOn(issue_auto_ok, 'resolve')
const link_release = vi.spyOn(issue_release_cli, 'link')

// The filing's `filed` event is asserted in `issue-file-cli-record.test.ts`; here it is only kept off
// the real stream. The fold question's answers are `issue-file-fold.test.ts`'s; here it only clears.
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
const fold_clear = vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
const NOT_APPLIED = { is_applied: false, reason: 'stubbed' }
const UNDECLARED = { is_opted_out: false, is_requested: false }
const REQUESTED_FLAG = '--requested'

// A listing of `count` open Issues, in the JSON shape `issue_list` answers with.
function listing_of(count: number): { json: string; is_capped: boolean } {
	const rows = Array.from({ length: count }, (_unused, index) => ({ number: index + 1 }))

	return { json: JSON.stringify(rows), is_capped: false }
}

const OVER_CAP_LISTING = listing_of(issue_wip.WIP_CAP + 1)
const OVER_CAP_FLAG = '--over-cap'

function argv_of(body_path: string, ...extra: ReadonlyArray<string>): Array<string> {
	return [TITLE, '--body-file', body_path, '--depth', '1', ...extra]
}

function create_body(): unknown {
	const [request] = exec_gh_api.mock.calls[0] ?? []

	return JSON.parse(request?.body ?? '{}')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue(OWNER)
	scout.mockResolvedValue({ report: 'Duplicates: none', candidates: [] })
	exec_gh_api.mockResolvedValue(ISSUE_URL)
	report_for.mockResolvedValue(SUCCESS_EXIT_CODE)
	ensure_labels.mockReturnValue([])
	issue_list.mockResolvedValue(listing_of(1))
	resolve_auto_ok.mockResolvedValue(NOT_APPLIED)
})

afterEach(() => {
	vi.clearAllMocks()
	Reflect.deleteProperty(process.env, 'GH_REPO')
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_cli.run — a filing that clears every step', () => {
	it('files once with every label, then runs epic:bundle on the new Issue', async () => {
		expect(await issue_file_cli.run(argv_of(valid_path, '--route', 'interrupt'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(exec_gh_api).toHaveBeenCalledTimes(1)
		expect(create_body()).toStrictEqual({
			title: TITLE,
			labels: ['depth:1', 'route:interrupt', 'bug'],
			body: VALID_BODY,
		})
		expect(report_for).toHaveBeenCalledWith(ISSUE_NUMBER, HERE, issue_file_cli.FRESH_ISSUE_POLL)
	})

	// joshuafolkken/kit#3332: the open listing trails the create call, so the just-filed Issue is
	// looked for more than once rather than declared "not an open issue" on the first read.
	it('asks epic:bundle to wait for the new Issue to reach the open listing', () => {
		expect(issue_file_cli.FRESH_ISSUE_POLL.attempts).toBeGreaterThan(1)
	})

	// joshuafolkken/kit#3423: the one `--distinct` declaration answers both the scout and the fold
	// question, so the filing needs no `issue:fold` call in front of it.
	it('files past a candidate declared separate', async () => {
		scout.mockResolvedValue(HELD_SCOUT)
		const argv = argv_of(valid_path, '--distinct', String(DUPLICATE))

		expect(await issue_file_cli.run(argv)).toBe(SUCCESS_EXIT_CODE)
		expect(fold_clear.mock.calls[0]?.[1].distinct).toStrictEqual([DUPLICATE])
		expect(exec_gh_api).toHaveBeenCalledTimes(1)
	})

	// The Issue exists once the create returns, so a placement that fails is a warning, not a failure.
	it('still succeeds when epic:bundle does not answer', async () => {
		report_for.mockResolvedValue(FAILURE_EXIT_CODE)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('epic:bundle')
	})

	it('points the scout at the target repository when filing elsewhere', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(SUCCESS_EXIT_CODE)
		expect(process.env['GH_REPO']).toBe(THERE)
		expect(scout).toHaveBeenCalledWith(expect.anything(), THERE)
	})
})

// joshuafolkken/kit#3176: a repository missing the depth labels gets them before the create call, so
// the create never auto-creates one with a generated color.
describe('issue_file_cli.run — the labels it applies exist first', () => {
	it('provisions the missing labels in the target repository before the create call', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(SUCCESS_EXIT_CODE)
		expect(ensure_labels).toHaveBeenCalledExactlyOnceWith(THERE)
		expect(ensure_labels.mock.invocationCallOrder[0]).toBeLessThan(
			exec_gh_api.mock.invocationCallOrder[0] ?? 0,
		)
	})
})

// joshuafolkken/kit#3213: the create call carries `auto-ok` when the filing opted in, unless
// `--no-auto-ok` is declared, and the decision is printed with its reason.
const CARRIED = { is_release: false, is_carried: true, branch_labels: undefined }

function stub_carried(): void {
	resolve_auto_ok.mockImplementation(async (declared) => {
		return issue_auto_ok.decide({ ...declared, ...CARRIED })
	})
}

describe('issue_file_cli.run — the auto-ok decision', () => {
	it('adds auto-ok to the create call when the filing opted in', async () => {
		stub_carried()

		expect(await issue_file_cli.run(argv_of(valid_path, '--label', 'run:lane'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(create_body()).toMatchObject({ labels: ['depth:1', 'run:lane', 'bug', 'auto-ok'] })
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain('auto-ok: applied — ')
	})
})

// joshuafolkken/kit#3313: an untriaged opted-in Issue withholds every lane's candidate.
describe('issue_file_cli.run — the run label an auto-ok filing owes', () => {
	it('refuses an auto-ok filing with no run label, before the count, the scout or the create', async () => {
		stub_carried()

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('--label run:solo')
		expect(issue_list).not.toHaveBeenCalled()
		expect(scout).not.toHaveBeenCalled()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('files an auto-ok filing judged run:solo', async () => {
		stub_carried()

		expect(await issue_file_cli.run(argv_of(valid_path, '--label', 'run:solo'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(create_body()).toMatchObject({ labels: ['depth:1', 'run:solo', 'bug', 'auto-ok'] })
	})

	it('files without a run label when auto-ok is not applied, as before', async () => {
		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(create_body()).toMatchObject({ labels: ['depth:1', 'bug'] })
	})
})

// joshuafolkken/kit#3614: `--requested` (a person asked for the filing) withholds it like the opt-out.
describe('issue_file_cli.run — the auto-ok opt-out and the repositories it reads', () => {
	it.each([
		['--no-auto-ok', { ...UNDECLARED, is_opted_out: true }],
		[REQUESTED_FLAG, { ...UNDECLARED, is_requested: true }],
	])('leaves auto-ok off with %s, printing why', async (flag, declared) => {
		stub_carried()

		expect(await issue_file_cli.run(argv_of(valid_path, flag))).toBe(SUCCESS_EXIT_CODE)
		expect(resolve_auto_ok).toHaveBeenCalledWith(declared, HERE, HERE, [])
		expect(create_body()).toMatchObject({ labels: ['depth:1', 'bug'] })
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain('auto-ok: not applied — ')
	})

	it('decides auto-ok with both the target and the current repository', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(SUCCESS_EXIT_CODE)
		expect(resolve_auto_ok).toHaveBeenCalledWith(UNDECLARED, THERE, HERE, [])
	})

	it.each([[[]], [[REQUESTED_FLAG]]])('keeps a named auto-ok once (%j)', async (extra) => {
		stub_carried()
		const argv = argv_of(valid_path, ...extra, '--label', 'auto-ok', '--label', 'run:lane')

		expect(await issue_file_cli.run(argv)).toBe(SUCCESS_EXIT_CODE)
		expect(create_body()).toMatchObject({ labels: ['depth:1', 'auto-ok', 'run:lane', 'bug'] })
	})
})

// joshuafolkken/kit#3360: `--release` links the filed Issue to the target's release Issue.
describe('issue_file_cli.run — --release', () => {
	it('links the new Issue to the release Issue, and does nothing without the flag', async () => {
		link_release.mockResolvedValue(true)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(link_release).not.toHaveBeenCalled()
		expect(await issue_file_cli.run(argv_of(valid_path, '--release'))).toBe(SUCCESS_EXIT_CODE)
		expect(link_release).toHaveBeenCalledWith(ISSUE_NUMBER, HERE)
	})

	// The Issue exists once the create returns, so a link that fails is a warning, not a failure.
	it('still succeeds when the link fails, naming the target in the re-run hint', async () => {
		link_release.mockResolvedValue(false)

		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE, '--release'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			`GH_REPO=${THERE} pnpm josh issue:release`,
		)
	})
})

describe('issue_file_cli.run — the WIP cap count', () => {
	it('prints the count against the cap and files within it', async () => {
		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain(`wip: 1 open in ${HERE}`)
	})

	it('counts the repository named by --repo', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(SUCCESS_EXIT_CODE)
		expect(issue_list).toHaveBeenCalledWith(expect.objectContaining({ repo: THERE }))
	})

	it('holds a filing past the cap with no exemption, before the scout or the create', async () => {
		issue_list.mockResolvedValue(OVER_CAP_LISTING)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(OVER_CAP_FLAG)
		for (const step of [scout, exec_gh_api]) expect(step).not.toHaveBeenCalled()
	})

	it.each([
		[OVER_CAP_FLAG, [OVER_CAP_FLAG]],
		['an exempt route', ['--route', 'interrupt']],
	])('files past the cap with %s', async (_label, extra) => {
		issue_list.mockResolvedValue(OVER_CAP_LISTING)

		expect(await issue_file_cli.run(argv_of(valid_path, ...extra))).toBe(SUCCESS_EXIT_CODE)
		expect(exec_gh_api).toHaveBeenCalledTimes(1)
	})

	it('warns and files when the count cannot be read', async () => {
		issue_list.mockResolvedValue({ json: undefined, is_capped: false })

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('could not count')
	})
})

describe('issue_file_cli.run — a refused filing sends nothing', () => {
	it('refuses a body the lint rejects', async () => {
		expect(await issue_file_cli.run(argv_of(invalid_path))).toBe(FAILURE_EXIT_CODE)
		expect(scout).not.toHaveBeenCalled()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('refuses a cross-repository filing with no Origin', async () => {
		expect(await issue_file_cli.run(argv_of(valid_path, '--repo', THERE))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('## Origin')
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('refuses a third-party target', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', FOREIGN))).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(console.error).toHaveBeenCalledWith(issue_file_cli.THIRD_PARTY_MESSAGE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(ensure_labels).not.toHaveBeenCalled()
	})
})

describe('issue_file_cli.run — a filing held at the scout or the create sends nothing more', () => {
	// joshuafolkken/kit#3423: the fold question is the command's first step, ahead of the count.
	it('holds a filing that folds before anything is listed or sent', async () => {
		fold_clear.mockResolvedValueOnce(false)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		for (const step of [issue_list, scout, exec_gh_api]) expect(step).not.toHaveBeenCalled()
	})

	it('holds a filing whose duplicate candidate is not declared separate', async () => {
		scout.mockResolvedValue(HELD_SCOUT)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(DISTINCT_HINT)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('fails when the scout cannot read the backlog', async () => {
		scout.mockResolvedValue(undefined)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('fails without running epic:bundle when the create call fails', async () => {
		exec_gh_api.mockRejectedValue(new Error('gh failed'))

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(report_for).not.toHaveBeenCalled()
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('gh failed')
	})

	it.each([
		['malformed arguments', [TITLE]],
		['an unreadable body file', argv_of(path.join(work, 'missing.md'))],
	])('refuses %s', async (_label, argv) => {
		expect(await issue_file_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})
