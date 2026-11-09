import { describe, expect, it } from 'vitest'
import { gh_call_kind } from './gh-call-kind'

// joshuafolkken/kit#6867: the kind `gh:usage` counts one gh call under.

const ISSUE_PATH = 'repos/o/r/issues/1'
const ISSUE_KIND = 'GET repos/{o}/{r}/issues/{n}'
const RATE_LIMIT = 'GET rate_limit'
const GRAPHQL = 'graphql'
const ISSUE_VIEW = 'gh issue view'

describe('gh_call_kind.of_api', () => {
	it.each([
		['repos/joshuafolkken/kit/issues/6867', ISSUE_KIND],
		[
			'/repos/{owner}/{repo}/pulls/12/comments?per_page=100',
			'GET repos/{o}/{r}/pulls/{n}/comments',
		],
		['repos/o/r/commits/main/check-runs', 'GET repos/{o}/{r}/commits/{ref}/check-runs'],
		['repos/o/r/git/refs/heads/6867-lane', 'GET repos/{o}/{r}/git/refs/heads/{branch}'],
		['repos/o/r/branches/main/protection', 'GET repos/{o}/{r}/branches/{branch}/protection'],
		['repos/o/r/issues/5/labels/in-progress', 'GET repos/{o}/{r}/issues/{n}/labels/{label}'],
		['repos/o/r/compare/main...6867-lane', 'GET repos/{o}/{r}/compare/{range}'],
		['repos/o/r/git/trees/78e54b2a1', 'GET repos/{o}/{r}/git/trees/{sha}'],
		['rate_limit', RATE_LIMIT],
	])('normalizes %s', (path, kind) => {
		expect(gh_call_kind.of_api(path)).toBe(kind)
	})

	it('upper-cases the method, and folds GraphQL into one kind whatever the method', () => {
		expect(gh_call_kind.of_api(ISSUE_PATH, 'patch')).toBe('PATCH repos/{o}/{r}/issues/{n}')
		expect(gh_call_kind.of_api(GRAPHQL, 'POST')).toBe(GRAPHQL)
	})
})

describe('gh_call_kind.of', () => {
	it.each([
		[['api', ISSUE_PATH], ISSUE_KIND],
		[
			['api', '--include', '-H', 'If-None-Match: x', 'repos/o/r/pulls/2'],
			'GET repos/{o}/{r}/pulls/{n}',
		],
		[['api', ISSUE_PATH, '-X', 'DELETE'], 'DELETE repos/{o}/{r}/issues/{n}'],
		[['api', 'repos/o/r/issues', '--input', '-'], 'POST repos/{o}/{r}/issues'],
		[['api', GRAPHQL, '-f', 'query=x'], GRAPHQL],
		[['issue', 'view', '6867', '--json', 'title'], ISSUE_VIEW],
		[['auth', '--help'], 'gh auth'],
		[[], 'gh'],
	])('names %j as %s', (arguments_, kind) => {
		expect(gh_call_kind.of(arguments_)).toBe(kind)
	})
})

describe('gh_call_kind.class_of', () => {
	it.each([
		[ISSUE_KIND, 'rest'],
		[GRAPHQL, 'graphql'],
		[ISSUE_VIEW, 'gh'],
		[RATE_LIMIT, 'free'],
	] as const)('classes %s as %s', (kind, call_class) => {
		expect(gh_call_kind.class_of(kind)).toBe(call_class)
	})
})
