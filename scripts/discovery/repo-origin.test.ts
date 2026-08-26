import { describe, expect, it } from 'vitest'
import { repo_origin } from './repo-origin'

const EXPECTED = { owner: 'joshuafolkken', repo: 'kit' }
const SSH_REMOTE = 'git@github.com:joshuafolkken/kit.git'
const HTTPS_REMOTE = 'https://github.com/joshuafolkken/kit.git'
const KIT_KEY = 'joshuafolkken/kit'
const SSH_ALIAS_HOST = 'github-work'

describe('repo_origin.parse_origin_url — the four measured remote forms', () => {
	it('normalizes the scp-like SSH form', () => {
		expect(repo_origin.parse_origin_url(SSH_REMOTE)).toEqual(EXPECTED)
	})

	it('normalizes an SSH host alias to the same identity', () => {
		expect(repo_origin.parse_origin_url(`git@${SSH_ALIAS_HOST}:joshuafolkken/kit.git`)).toEqual(
			EXPECTED,
		)
	})

	it('normalizes HTTPS carrying credentials and a trailing slash', () => {
		expect(
			repo_origin.parse_origin_url('https://someone@github.com/joshuafolkken/kit.git/'),
		).toEqual(EXPECTED)
	})

	it('normalizes plain HTTPS', () => {
		expect(repo_origin.parse_origin_url(HTTPS_REMOTE)).toEqual(EXPECTED)
	})

	it('normalizes a remote without the .git suffix', () => {
		expect(repo_origin.parse_origin_url('https://github.com/joshuafolkken/kit')).toEqual(EXPECTED)
	})

	it('accepts the ssh:// URL form', () => {
		expect(repo_origin.parse_origin_url('ssh://git@github.com/joshuafolkken/kit.git')).toEqual(
			EXPECTED,
		)
	})
})

describe('repo_origin.parse_origin_url — non-GitHub remotes are excluded', () => {
	it('rejects a self-hosted git server over SSH', () => {
		expect(repo_origin.parse_origin_url('git@git.example.com:a/b.git')).toBeUndefined()
	})

	it('rejects another forge over HTTPS', () => {
		expect(repo_origin.parse_origin_url('https://gitlab.com/a/b.git')).toBeUndefined()
	})

	it('rejects a hostname that merely starts with github', () => {
		expect(repo_origin.parse_origin_url('https://github.example.com/a/b.git')).toBeUndefined()
	})

	it('rejects a dotted enterprise host that shares the github prefix', () => {
		expect(
			repo_origin.parse_origin_url('git@github-enterprise.example.com:a/b.git'),
		).toBeUndefined()
	})

	it('rejects a blank remote', () => {
		expect(repo_origin.parse_origin_url('  ')).toBeUndefined()
	})

	it('rejects a path that is not exactly owner/repo', () => {
		expect(repo_origin.parse_origin_url('https://github.com/joshuafolkken')).toBeUndefined()
		expect(repo_origin.parse_origin_url('https://github.com/a/b/c')).toBeUndefined()
	})
})

describe('repo_origin.parse_origin_from_config', () => {
	it('reads the url of the origin remote', () => {
		const content = [
			'[core]',
			'\tbare = false',
			'[remote "origin"]',
			`\turl = ${SSH_REMOTE}`,
			'\tfetch = +refs/heads/*:refs/remotes/origin/*',
		].join('\n')

		expect(repo_origin.parse_origin_from_config(content)).toBe(SSH_REMOTE)
	})

	it('does not read the url of a different remote as origin', () => {
		const content = ['[remote "upstream"]', `\turl = ${HTTPS_REMOTE}`, '[branch "main"]'].join('\n')

		expect(repo_origin.parse_origin_from_config(content)).toBeUndefined()
	})

	it('returns nothing for a config with no remotes at all', () => {
		expect(repo_origin.parse_origin_from_config('[core]\n\tbare = false')).toBeUndefined()
	})
})

describe('repo_origin.format_identity', () => {
	it('joins the identity into the owner/repo key', () => {
		expect(repo_origin.format_identity(EXPECTED)).toBe(KIT_KEY)
	})
})

describe('repo_origin — an SSH alias is not a hostname', () => {
	it('accepts a dotless alias in the scp-like SSH form', () => {
		expect(repo_origin.is_github_ssh_host(SSH_ALIAS_HOST)).toBe(true)
	})

	it('refuses the same alias as a URL hostname', () => {
		expect(repo_origin.is_github_hostname(SSH_ALIAS_HOST)).toBe(false)
		expect(repo_origin.parse_origin_url('https://github-internal/a/b.git')).toBeUndefined()
	})
})

describe('repo_origin.format_identity — one repository, one key', () => {
	it('lowercases the key so a differently-spelled remote maps to the same entry', () => {
		expect(repo_origin.format_identity({ owner: 'JoshuaFolkken', repo: 'Kit' })).toBe(KIT_KEY)
	})
})
