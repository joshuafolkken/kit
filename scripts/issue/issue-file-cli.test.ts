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
const JUDGEMENT_NOT_NEEDED = '- 人の判断: 不要'

const SECTIONS = '## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n'

// A body the lint accepts, with `declarations` under its background.
function body_of(...declarations: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 不具合', '- 原因: #4201', ...declarations, '', SECTIONS].join(
		'\n',
	)
}

const VALID_BODY = body_of('- 人の判断: 要（目視確認）')

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-'))
const valid_path = path.join(work, 'valid.md')
const invalid_path = path.join(work, 'invalid.md')
const origin_path = path.join(work, 'origin.md')
const judged_in_path = path.join(work, 'judged-in.md')
const breaking_path = path.join(work, 'breaking.md')
const undeclared_path = path.join(work, 'undeclared.md')

writeFileSync(valid_path, VALID_BODY)
writeFileSync(judged_in_path, body_of(JUDGEMENT_NOT_NEEDED))
writeFileSync(breaking_path, body_of(JUDGEMENT_NOT_NEEDED, '- 互換性: 破壊的変更'))
writeFileSync(undeclared_path, body_of())
writeFileSync(invalid_path, '## 背景\n')
writeFileSync(origin_path, `${body_of(JUDGEMENT_NOT_NEEDED)}\n## Origin\n\n${HERE}#2808\n`)

const scout = vi.spyOn(issue_scout_cli, 'scout')
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const report_for = vi.spyOn(epic_bundle_cli, 'report_for')
const ensure_labels = vi.spyOn(repository_labels, 'ensure_labels')
const issue_list = vi.spyOn(git_gh_issue_list, 'issue_list')
const link_release = vi.spyOn(issue_release_cli, 'link')

// The filing's `filed` event is asserted in `issue-file-cli-record.test.ts`; here it is only kept off
// the real stream. The fold question's answers are `issue-file-fold.test.ts`'s; here it only clears.
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
const fold_clear = vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)

// A listing of `count` open Issues, in the JSON shape `issue_list` answers with.
function listing_of(count: number): { json: string; is_capped: boolean } {
	const rows = Array.from({ length: count }, (_unused, index) => ({ number: index + 1 }))

	return { json: JSON.stringify(rows), is_capped: false }
}

const OVER_CAP_LISTING = listing_of(issue_wip.WIP_CAP + 1)
const OVER_CAP_FLAG = '--over-cap'

function argv_of(body_path: string, ...extra: ReadonlyArray<string>): Array<string> {
	return [TITLE, '--body-file', body_path, ...extra]
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
			labels: ['route:interrupt', 'bug'],
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

// joshuafolkken/kit#3176: a repository missing the workflow labels gets them before the create call, so
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

// joshuafolkken/kit#3853: the create call carries `auto-ok` when the filing is judged in by the
// criteria — whoever asked for it — and the decision is printed with its reason.
describe('issue_file_cli.run — the auto-ok decision', () => {
	it('adds auto-ok to the create call when the body declares no judgement is needed', async () => {
		expect(await issue_file_cli.run(argv_of(judged_in_path, '--label', 'run:lane'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(create_body()).toMatchObject({ labels: ['run:lane', 'bug', 'auto-ok'] })
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain('auto-ok: applied — ')
	})

	it.each([
		[[breaking_path, '--label', 'run:lane'], 'a `breaking-change` Issue'],
		[[judged_in_path, '--no-auto-ok'], '--no-auto-ok declared'],
		[[origin_path, '--repo', THERE], 'the Issue is filed to another repository'],
	])('leaves auto-ok off %j, printing why', async ([body_path = '', ...extra], reason) => {
		expect(await issue_file_cli.run(argv_of(body_path, ...extra))).toBe(SUCCESS_EXIT_CODE)
		expect(JSON.stringify(create_body())).not.toContain('auto-ok')
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain(
			`auto-ok: not applied — ${reason}`,
		)
	})

	it('refuses a body with no judgement declaration, before the count, the scout or the create', async () => {
		expect(await issue_file_cli.run(argv_of(undeclared_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('`- 人の判断: 不要`')
		expect(issue_list).not.toHaveBeenCalled()
		expect(scout).not.toHaveBeenCalled()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3313: an untriaged opted-in Issue withholds every lane's candidate.
describe('issue_file_cli.run — the run label an auto-ok filing owes', () => {
	it('refuses an auto-ok filing with no run label, before the count, the scout or the create', async () => {
		expect(await issue_file_cli.run(argv_of(judged_in_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('--label run:solo')
		expect(issue_list).not.toHaveBeenCalled()
		expect(scout).not.toHaveBeenCalled()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('files an auto-ok filing judged run:solo', async () => {
		expect(await issue_file_cli.run(argv_of(judged_in_path, '--label', 'run:solo'))).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(create_body()).toMatchObject({ labels: ['run:solo', 'bug', 'auto-ok'] })
	})

	it('files without a run label when auto-ok is not applied, as before', async () => {
		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(SUCCESS_EXIT_CODE)
		expect(create_body()).toMatchObject({ labels: ['bug'] })
	})
})

describe('issue_file_cli.run — a named auto-ok', () => {
	it('keeps a named auto-ok once', async () => {
		const argv = argv_of(judged_in_path, '--label', 'auto-ok', '--label', 'run:lane')

		expect(await issue_file_cli.run(argv)).toBe(SUCCESS_EXIT_CODE)
		expect(create_body()).toMatchObject({ labels: ['auto-ok', 'run:lane', 'bug'] })
	})

	it('no longer accepts --requested', async () => {
		expect(await issue_file_cli.run(argv_of(judged_in_path, '--requested'))).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
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
