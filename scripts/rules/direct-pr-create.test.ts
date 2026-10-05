import { describe, expect, it } from 'vitest'
import { direct_pr_create } from './direct-pr-create'

// joshuafolkken/kit#3183: a PR opened outside `pnpm josh pr` loses its `closes #N` line. The refused
// set is `gh pr create` in every wrapper spelling and a `gh api` write to the pulls collection; the
// silent set is `pnpm josh pr` itself, PR reads, and writes to a single PR's sub-resources.

describe('direct_pr_create.is_direct_pr_create — refuses', () => {
	it.each([
		'gh pr create --title "x" --body-file /tmp/body.md',
		'gh pr create',
		'env gh pr create --fill',
		'GH_TOKEN=x gh pr create --fill',
		'git push && gh pr create --fill',
		'gh pr new --fill',
		'gh pr -R joshuafolkken/kit create --fill',
		'gh pr --repo=joshuafolkken/kit create --fill',
		'gh --repo joshuafolkken/kit pr create --fill',
		'gh api https://api.github.com/repos/joshuafolkken/kit/pulls -f title=x',
		'gh api repos/joshuafolkken/kit/pulls -f title=x -f head=a -f base=main',
		'gh api -X POST /repos/joshuafolkken/kit/pulls --input /tmp/pr.json',
		'gh api repos/{owner}/{repo}/pulls --field title=x',
		"gh api 'repos/joshuafolkken/kit/pulls' -F draft=true",
	])('refuses %j', (command) => {
		expect(direct_pr_create.is_direct_pr_create(command)).toBe(true)
	})
})

describe('direct_pr_create.is_direct_pr_create — is silent on', () => {
	it.each([
		'pnpm josh pr',
		'pnpm josh git -y "Refuse direct gh pr create calls #3183"',
		'gh pr view 12',
		'gh pr list --state open',
		'gh pr -R joshuafolkken/kit list',
		'gh pr view create',
		'gh api repos/joshuafolkken/kit/pulls',
		'gh api -X GET repos/joshuafolkken/kit/pulls -f state=open',
		'gh api repos/joshuafolkken/kit/pulls/5/comments -f body=x',
		'gh api -X PATCH repos/joshuafolkken/kit/pulls/5 -f title=x',
		'echo "gh pr create"',
	])('%j', (command) => {
		expect(direct_pr_create.is_direct_pr_create(command)).toBe(false)
	})
})

describe('direct_pr_create.DIRECT_PR_CREATE_REASON', () => {
	it('points to pnpm josh pr', () => {
		expect(direct_pr_create.DIRECT_PR_CREATE_REASON).toContain('`pnpm josh pr`')
	})
})
