import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { package_path } from './init-paths'
import { security_policy } from './security-policy'

const origin_url_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-spawn-sync', () => ({
	git_spawn_sync: { origin_url: origin_url_mock },
}))

const ROOT = '/project'
const DESTINATION = `${ROOT}/SECURITY.md`
const REPOSITORY = 'Owner/app-kit'
const SSH_ORIGIN = `git@github.com:${REPOSITORY}.git`
const { KIT_ADVISORY_URL } = security_policy
const DOTTED_ALIAS_ORIGIN = 'git@github.com-work:owner/repo.git'

function read_template(): string {
	return readFileSync(package_path(security_policy.SECURITY_TEMPLATE), 'utf8')
}

describe('security_policy.repository_at', () => {
	beforeEach(() => {
		origin_url_mock.mockReset()
	})

	it('reads owner/repo from a GitHub origin, keeping its spelling', () => {
		origin_url_mock.mockReturnValue(SSH_ORIGIN)

		expect(security_policy.repository_at(ROOT)).toBe(REPOSITORY)
		expect(origin_url_mock).toHaveBeenCalledWith(ROOT)
	})

	it('answers nothing without an origin', () => {
		origin_url_mock.mockReturnValue(undefined)

		expect(security_policy.repository_at(ROOT)).toBeUndefined()
	})

	it('answers nothing for an origin that is not GitHub', () => {
		origin_url_mock.mockReturnValue('https://gitlab.com/owner/repo.git')

		expect(security_policy.repository_at(ROOT)).toBeUndefined()
	})
})

describe('security_policy.apply_repository_for_destination', () => {
	beforeEach(() => {
		origin_url_mock.mockReset()
	})

	it('points the advisory and release links at the repository the file lands in', () => {
		origin_url_mock.mockReturnValue(SSH_ORIGIN)
		const written = security_policy.apply_repository_for_destination(DESTINATION, read_template())

		expect(written).toContain(`https://github.com/${REPOSITORY}/security/advisories/new`)
		expect(written).toContain(`https://github.com/${REPOSITORY}/releases`)
		expect(written).not.toContain(security_policy.REPOSITORY_PLACEHOLDER)
		expect(written).not.toContain(KIT_ADVISORY_URL)
	})

	it('leaves every other destination alone without asking for the origin', () => {
		const text = `see ${security_policy.REPOSITORY_PLACEHOLDER}`

		expect(security_policy.apply_repository_for_destination(`${ROOT}/README.md`, text)).toBe(text)
		expect(origin_url_mock).not.toHaveBeenCalled()
	})

	it('refuses to write the placeholder through when the repository is unresolved', () => {
		origin_url_mock.mockReturnValue(undefined)

		expect(() => security_policy.apply_repository_for_destination(DESTINATION, 'text')).toThrow(
			/GitHub origin/u,
		)
	})
})

function did_skip(root: string): boolean {
	return security_policy.did_skip_unresolved(security_policy.SECURITY_MD, root)
}

describe('security_policy.did_skip_unresolved', () => {
	const warn_spy = vi.spyOn(console, 'warn')

	beforeEach(() => {
		origin_url_mock.mockReset()
		warn_spy.mockReset().mockReturnValue()
	})

	afterEach(() => {
		warn_spy.mockReset()
	})

	it('skips SECURITY.md with a warning when there is no GitHub origin', () => {
		origin_url_mock.mockReturnValue(undefined)

		expect(did_skip(ROOT)).toBe(true)
		expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('skipped'))
		expect(warn_spy).not.toHaveBeenCalledWith(expect.stringContaining('stale'))
	})

	it('writes SECURITY.md when the origin is GitHub', () => {
		origin_url_mock.mockReturnValue(SSH_ORIGIN)

		expect(did_skip(ROOT)).toBe(false)
		expect(warn_spy).not.toHaveBeenCalled()
	})

	it('never skips another file, and never asks for the origin on its behalf', () => {
		expect(security_policy.did_skip_unresolved('AGENTS.md', ROOT)).toBe(false)
		expect(origin_url_mock).not.toHaveBeenCalled()
	})
})

describe('security_policy.did_skip_unresolved over a policy already on disk', () => {
	const warn_spy = vi.spyOn(console, 'warn')
	let project_root = ''

	function write_policy(content: string): void {
		writeFileSync(path.join(project_root, security_policy.SECURITY_MD), content)
	}

	beforeEach(() => {
		warn_spy.mockReset().mockReturnValue()
		project_root = mkdtempSync(path.join(tmpdir(), 'kit-security-policy-test-'))
	})

	afterEach(() => {
		warn_spy.mockReset()
		rmSync(project_root, { recursive: true, force: true })
	})

	it("says kit's policy left by an earlier sync is stale, for an origin it cannot read", () => {
		origin_url_mock.mockReturnValue(DOTTED_ALIAS_ORIGIN)
		write_policy(`[advisory](${KIT_ADVISORY_URL})`)

		expect(did_skip(project_root)).toBe(true)
		expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('still reports vulnerabilities'))
		expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('not a GitHub repository'))
	})

	it("does not call a consumer's own policy stale", () => {
		origin_url_mock.mockReturnValue(undefined)
		write_policy('# Our own policy')

		expect(did_skip(project_root)).toBe(true)
		expect(warn_spy).not.toHaveBeenCalledWith(expect.stringContaining('stale'))
	})
})

describe('the consumer SECURITY.md template', () => {
	it('does not describe kit as the repository it is written into', () => {
		const template = read_template()

		expect(template).not.toContain('Published Package Contents')
		expect(template).not.toContain('.env.example')
		expect(template).not.toContain('kit never stores')
		expect(template).not.toContain(KIT_ADVISORY_URL)
	})

	it('leaves the reader a link to kit for the tooling it ships', () => {
		expect(read_template()).toContain('https://github.com/joshuafolkken/kit/blob/main/SECURITY.md')
	})

	it("is not kit's own policy, which still reports to kit", () => {
		expect(readFileSync(package_path('SECURITY.md'), 'utf8')).toContain(KIT_ADVISORY_URL)
	})
})
