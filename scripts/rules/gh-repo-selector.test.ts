import { describe, expect, it } from 'vitest'
import { gh_repo_selector } from './gh-repo-selector'

// The `-R` / `--repo` selector of a `gh` write (joshuafolkken/kit#4659): every spelling read, a read
// action and `gh api` left alone.

const TARGET = 'other/x'
const EXPORTED_TARGET = 'export GH_REPO=other/x'

describe('gh_repo_selector.write_selectors', () => {
	it.each([
		['a separate -R', 'gh pr create -R other/x --title t --body b'],
		['a separate --repo', 'gh issue comment 5 --repo other/x --body b'],
		['an attached --repo=', 'gh issue comment 5 --repo=other/x --body b'],
		['an attached -R=', 'gh issue close 5 -R=other/x'],
		['a quoted value', "gh issue edit 5 -R 'other/x' --add-label x"],
		['a selector before the group', 'gh -R other/x release create v1'],
	])('reads %s on a write', (_name, segment) => {
		expect(gh_repo_selector.write_selectors([segment], 0)).toStrictEqual([TARGET])
	})

	it.each([
		['a view', 'gh pr view 5 -R other/x'],
		['a list', 'gh issue list --repo other/x'],
		['a checks read', 'gh pr checks 5 -R other/x'],
		['a variable get', 'gh variable get NAME -R other/x'],
		['an attestation verify', 'gh attestation verify a.tgz -R other/x'],
		['a browse', 'gh browse -R other/x'],
		['a gh api call', 'gh api -R other/x repos/other/x/issues -f title=t'],
		['a write with no selector', 'gh issue comment 5 --body b'],
		['another program', 'echo gh issue comment 5 -R other/x'],
	])('answers none for %s', (_name, segment) => {
		expect(gh_repo_selector.write_selectors([segment], 0)).toStrictEqual([])
	})
})

describe('gh_repo_selector.write_selectors — a GH_REPO assignment', () => {
	it.each([
		['an inline GH_REPO', ['GH_REPO=other/x gh issue comment 5 -b x'], 0],
		['an exported GH_REPO earlier in the line', [EXPORTED_TARGET, 'gh pr create'], 1],
	])('reads %s assigned to a write', (_name, segments, index) => {
		expect(gh_repo_selector.write_selectors(segments, index)).toStrictEqual([TARGET])
	})

	it('answers none for a GH_REPO before a read', () => {
		expect(gh_repo_selector.write_selectors([EXPORTED_TARGET, 'gh pr view 5'], 1)).toStrictEqual([])
	})
})
