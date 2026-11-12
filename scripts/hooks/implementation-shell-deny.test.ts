import { git_argv } from '#scripts/rules/git-argv'
import { describe, expect, it } from 'vitest'
import { implementation_shell_deny } from './implementation-shell-deny'

const GIT_PUSH = '`git push`'
const GIT_BRANCH = '`git branch`'
const GIT_STASH = '`git stash`'
const GH_ISSUE_CLOSE = '`gh issue close`'
const GH_API_WRITE = 'a `gh api` call other than GET'
const INSTALL = '`install`, a dependency change'
const ADD = '`add`, a dependency change'
const JOSH_GIT = '`josh git`'
const GIT_REFLOG = '`git reflog`'
const EXPANSION = 'an expansion that may spell a write'

const REFUSED: ReadonlyArray<readonly [string, string]> = [
	['git push --force', GIT_PUSH],
	['git push origin main', GIT_PUSH],
	['git commit -m x', '`git commit`'],
	['git reset --hard', '`git reset`'],
	['git clean -fd', '`git clean`'],
	['git branch -D topic', GIT_BRANCH],
	['git branch --move a b', GIT_BRANCH],
	['git stash', GIT_STASH],
	['git stash pop', GIT_STASH],
	['git worktree add ../x', '`git worktree`'],
	['git config user.name x', '`git config`'],
	['git -c core.fsmonitor=x status', 'rewrites its configuration'],
	['git diff --output=app.ts', 'writes a file'],
	['gh pr merge 1', '`gh pr merge`'],
	['gh issue close 1', GH_ISSUE_CLOSE],
	['gh issue -R owner/repo close 1', GH_ISSUE_CLOSE],
	['gh issue comment 1 --body x', '`gh issue comment`'],
	['gh pr checkout 1', '`gh pr checkout`'],
	['gh repo delete owner/repo', '`gh repo delete`'],
	['gh api -X PATCH repos/owner/repo/issues/1', GH_API_WRITE],
	['gh api repos/owner/repo/issues -f title=x', GH_API_WRITE],
	['gh api graphql -f query=mutation{x}', GH_API_WRITE],
	['pnpm install', INSTALL],
	['pnpm -s add -D left-pad', ADD],
	['pnpm update', '`update`, a dependency change'],
	['npm install left-pad', INSTALL],
	['pnpm josh git -y', `${JOSH_GIT}, a shared-state write`],
	['pnpm josh g -y', JOSH_GIT],
	['pnpm josh ship Title', '`josh ship`'],
	['pnpm josh followup 1', '`josh followup`'],
	['pnpm josh latest', '`josh latest`'],
	// joshuafolkken/kit#6586 review round 1: the writes the first deny-list let through.
	['gh api repos/owner/repo/issues/1 -iX DELETE', GH_API_WRITE],
	['git reflog expire --all', GIT_REFLOG],
	['git reflog delete HEAD@{1}', GIT_REFLOG],
	['git read-tree HEAD', '`git read-tree`'],
	['git fetch origin', '`git fetch`'],
	['git branch topic', GIT_BRANCH],
	['git tag v1', '`git tag`'],
	['yarn', INSTALL],
	['yarn --frozen-lockfile', INSTALL],
	['git $c origin', EXPANSION],
	['git branch $name', GIT_BRANCH],
	['"$GIT" push', 'a program an expansion names'],
	['gh issue $verb 1', EXPANSION],
	['gh $group close 1', EXPANSION],
	['pnpm josh $command', EXPANSION],
	['npm $action', EXPANSION],
	// joshuafolkken/kit#6586 review round 2: a manager flag's value read as the action.
	['npm --prefix web install', INSTALL],
	['yarn --cwd web add left-pad', ADD],
	['yarn --cwd web', INSTALL],
]

function refusal(segment: string): string | undefined {
	const call = git_argv.program_of(segment)
	if (call === undefined) return undefined

	return implementation_shell_deny.refusal(segment, call)
}

describe('implementation_shell_deny.refusal — the irreversible calls', () => {
	it.each(REFUSED)('refuses %s, naming %s', (segment, rule) => {
		expect(refusal(segment)).toContain(rule)
	})
})

const RUNS: ReadonlyArray<string> = [
	'git status',
	'git diff --stat HEAD',
	'git log --oneline -5',
	'git branch',
	'git branch -a --contains HEAD',
	'git stash list',
	'git worktree list',
	'git config --get user.name',
	'git remote -v',
	'git tag',
	'git tag --list v1*',
	'git tag -n',
	'git tag -n5 --sort=-version:refname',
	'git branch --format %(refname) --sort refname',
	'git reflog',
	'git reflog show main',
	'git diff $base HEAD',
	'gh issue view $number',
	'gh issue list --search close',
	'gh search issues $query',
	'gh api -iX GET repos/owner/repo/issues',
	'gh pr view 1',
	'gh issue list --state closed',
	'gh api repos/owner/repo/issues',
	'gh api repos/owner/repo -X GET -f state=open',
	'gh api graphql -f query={viewer{login}}',
	'pnpm view typescript version',
	'npm view typescript',
	'npm --prefix web test',
	'pnpm josh tree:status',
	'pnpm josh ship --log 1',
	'pnpm josh check',
	'pnpm josh run:handoff',
	'pnpm josh issue:comment 1 --body x',
	'pnpm josh issue:body 6982 --body-file .josh/tmp/issue-6982-body.md',
	'node scripts/probe.ts',
	'xargs cat',
]

describe('implementation_shell_deny.refusal — the calls that run', () => {
	it.each(RUNS)('lets %s run', (segment) => {
		expect(refusal(segment)).toBeUndefined()
	})
})
