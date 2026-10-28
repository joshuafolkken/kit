import { describe, expect, it } from 'vitest'
import { gh_api } from './gh-api'

// The shared reading of a `gh api` segment (joshuafolkken/kit#2122): the body-read guard and the
// third-party-write guard both classify read vs write and extract the repository from one place.

describe('gh_api.is_gh_api', () => {
	it.each([
		['bare', 'gh api repos/o/r/issues'],
		['global flag before the subcommand', 'gh --repo o/r api repos/o/r/issues'],
	])('recognizes a %s gh api call', (_name, command) => {
		expect(gh_api.is_gh_api(command)).toBe(true)
	})

	it.each([
		['gh issue view', 'gh issue view 5'],
		['plain git', 'git status'],
	])('is not a gh api call: %s', (_name, command) => {
		expect(gh_api.is_gh_api(command)).toBe(false)
	})
})

describe('gh_api read vs write', () => {
	it.each([
		['no flags', 'gh api repos/o/r/issues/5'],
		['explicit GET', 'gh api repos/o/r/issues/5 -X GET'],
		['jq projection', "gh api repos/o/r/issues/5 --jq '.state'"],
	])('reads: %s', (_name, command) => {
		expect(gh_api.is_read(command)).toBe(true)
		expect(gh_api.is_write(command)).toBe(false)
	})

	it.each([
		['short field', 'gh api repos/o/r/issues -f title=x'],
		['capital field', 'gh api repos/o/r/issues -F title=x'],
		['long field', 'gh api repos/o/r/issues --field title=x'],
		['raw field', 'gh api repos/o/r/issues --raw-field title=x'],
		['input file', 'gh api repos/o/r/issues/5/comments --input body.json'],
		['POST method', 'gh api repos/o/r/issues -X POST'],
		['DELETE method', 'gh api -X DELETE repos/o/r/issues/5/labels/x'],
		['attached method', 'gh api -XPUT repos/o/r/collaborators/x'],
		['method with equals', 'gh api --method=PATCH repos/o/r'],
		['attached short field', 'gh api repos/o/r/rulesets -fname=x'],
		['attached capital field', 'gh api repos/o/r/rulesets -Fname=x'],
		[
			'method spelled inside a field value',
			"gh api repos/o/r/rulesets -f name=x -f 'note=a -X GET'",
		],
		['the last method winning', 'gh api repos/o/r/rulesets -X GET -X POST'],
	])('writes: %s', (_name, command) => {
		expect(gh_api.is_write(command)).toBe(true)
		expect(gh_api.is_read(command)).toBe(false)
	})
})

describe('gh_api.field_sources', () => {
	it.each([
		['a raw field', "gh api repos/o/r/issues/5/comments -f 'body=hi'", 'text', 'hi'],
		['a raw field naming a path', 'gh api x -f body=@notes.md', 'text', '@notes.md'],
		['a typed field', 'gh api x --field title=t', 'text', 't'],
		['a typed field read from a file', 'gh api x -F body=@notes.md', 'file', 'notes.md'],
		['a long typed field read from a file', 'gh api x --field "body=@a b.md"', 'file', 'a b.md'],
		['an input file', 'gh api x --input body.json', 'file', 'body.json'],
		['an attached input file', 'gh api x --input=body.json', 'file', 'body.json'],
		['an attached raw field', 'gh api x -fname=y', 'text', 'y'],
		['an attached typed field', 'gh api x -Fx=@b.md', 'file', 'b.md'],
	])('reads %s', (_name, command, kind, value) => {
		expect(gh_api.field_sources(command)).toStrictEqual([{ kind, value }])
	})

	it.each([
		['standard input', 'gh api x --input -'],
		['a typed field from standard input', 'gh api x -F body=@-'],
		['a call with no field', 'gh api repos/o/r/issues/5 --jq .body'],
	])('reads nothing from %s', (_name, command) => {
		expect(gh_api.field_sources(command)).toStrictEqual([])
	})
})

describe('gh_api.repo_target', () => {
	it.each([
		['bare path', 'gh api repos/joshuafolkken/kit/issues', 'joshuafolkken', 'kit'],
		['leading slash', 'gh api /repos/sveltejs/svelte/issues/5', 'sveltejs', 'svelte'],
		['sub-resource with a field', 'gh api repos/a/b/issues/5/comments -f body=x', 'a', 'b'],
	])('extracts owner/repo from %s', (_name, command, owner, repo) => {
		expect(gh_api.repo_target(command)).toStrictEqual({ owner, repo })
	})

	it.each([
		['a non-repo endpoint', 'gh api user'],
		['graphql', 'gh api graphql -f query=x'],
	])('returns undefined for %s', (_name, command) => {
		expect(gh_api.repo_target(command)).toBeUndefined()
	})
})
