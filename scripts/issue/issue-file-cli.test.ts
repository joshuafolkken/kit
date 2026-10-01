import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cli } from './issue-file-cli'
import { issue_scout_cli } from './issue-scout-cli'

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
		expect(report_for).toHaveBeenCalledWith(ISSUE_NUMBER, HERE)
	})

	it('files past a candidate declared separate', async () => {
		scout.mockResolvedValue(HELD_SCOUT)
		const argv = argv_of(valid_path, '--distinct', String(DUPLICATE))

		expect(await issue_file_cli.run(argv)).toBe(SUCCESS_EXIT_CODE)
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
	})
})

describe('issue_file_cli.run — a filing held at the scout or the create sends nothing more', () => {
	it('holds a filing whose duplicate candidate is not declared separate', async () => {
		scout.mockResolvedValue(HELD_SCOUT)

		expect(await issue_file_cli.run(argv_of(valid_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			`--distinct ${String(DUPLICATE)}`,
		)
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
