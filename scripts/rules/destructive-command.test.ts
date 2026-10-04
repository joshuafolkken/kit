import { describe, expect, it } from 'vitest'
import { destructive_command } from './destructive-command'

// joshuafolkken/kit#2983: the destructive commands the decision recorded on the Issue stops — a
// recursive forced `rm` in every spelling, `gh repo delete` / `archive` / a visibility change,
// `gh pr close`, and `gh api -X DELETE repos/…`. The silent set is what the decision keeps open:
// `gh issue close`, removing a label from an Issue, and a non-forced or non-recursive `rm`.

const LABEL_REMOVAL = 'gh api -X DELETE repos/joshuafolkken/kit/issues/5/labels/in-progress'

describe('destructive_command.is_destructive_command — refuses', () => {
	it.each([
		'rm -rf dist',
		'rm -fr dist',
		'rm -r -f dist',
		'rm -Rf dist',
		'rm --recursive --force dist',
		'sudo rm -fr /tmp/x',
		'gh repo delete joshuafolkken/kit --yes',
		'gh repo archive joshuafolkken/kit',
		'gh repo edit --visibility public',
		'gh pr close 12',
		'env gh pr close 12',
		'gh api -X DELETE repos/joshuafolkken/kit/labels/bug',
		'gh api --method DELETE repos/joshuafolkken/kit/issues/comments/9',
		'gh api -X DELETE repos/joshuafolkken/kit/git/refs/heads/topic',
		'env gh api -X DELETE repos/joshuafolkken/kit/labels/bug',
		'GH_TOKEN=x gh api --method DELETE repos/joshuafolkken/kit/issues/comments/9',
		'gh api -X DELETE repos/joshuafolkken/kit -f x=repos/joshuafolkken/kit/issues/5/labels/a',
	])('refuses %j', (command) => {
		expect(destructive_command.is_destructive_command(command)).toBe(true)
	})
})

describe('destructive_command.is_destructive_command — is silent on', () => {
	it.each([
		'rm -r dist',
		'rm -f stale.log',
		'rm file.txt',
		'gh issue close 5',
		'gh pr view 12',
		'gh repo view',
		'gh repo edit --description x',
		LABEL_REMOVAL,
		'gh api repos/joshuafolkken/kit/issues/5',
		'echo "rm -rf /"',
	])('%j', (command) => {
		expect(destructive_command.is_destructive_command(command)).toBe(false)
	})
})
