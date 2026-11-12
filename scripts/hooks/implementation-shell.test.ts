import { describe, expect, it } from 'vitest'
import { implementation_shell } from './implementation-shell'

const GIT_PUSH = '`git push`'
const CD_WRITE = 'a write beside `cd`'
const REDIRECT_APP = 'redirect to `app.ts`'
const GH_API_WRITE = 'a `gh api` call other than GET'
const INSTALL = '`install`, a dependency change'
const STDIN_SHELL = 'a shell running the commands its standard input spells'
const UNREAD_BODY = 'a `case` arm or function body'

// joshuafolkken/kit#6586: the investigation spellings the old allowlist refused now run.
const ISSUE_REPRODUCTIONS = [
	'F=/path/to/notes.md; cat "$F"',
	'git diff --shortstat "$(git rev-list -1 --before=\'7 days ago\' main)" HEAD',
	"find prompts -name '*.md' -print0 | xargs -0 cat | wc -l",
	"find prompts -name '*.md' -exec cat {} + | wc -l",
	'pnpm josh tree:status',
]

const RUNS = [
	'git status --short',
	'git -C /tmp/repo diff --stat',
	'grep -rn is_carry_candidate scripts/review',
	'ls .git/josh/run-state/ | grep 5757',
	'cat scripts/hooks/*.ts',
	'echo $(git log -1 --format=%H)',
	'GIT_PAGER=cat git log -1',
	'node scripts/probe.ts',
	'time node scripts/probe.ts',
	'pnpm josh check',
	'pnpm josh lint:related',
	'pnpm josh ship --log 5757',
	'pnpm view typescript version',
	"gh api graphql -f query='{ viewer { login } }'",
	'gh api repos/owner/repo/issues -f state=open -X GET',
	'cd /tmp/other-repo && grep -n pattern notes.md',
	'for f in a.md b.md; do grep -n pattern $f; done',
	'for f in a.md b.md\ndo\n\tgrep -n pattern $f\ndone',
	'npx done',
	'if git diff --quiet; then echo same; fi',
	'case "$x" in a|b) echo same ;; *) git status ;; esac',
	'function f { git log -1; }; f',
	'select x in a b; do echo $x; done',
	'(cd /tmp/other-repo && git log -1)',
	"sed -n '1,5p' scripts/a.ts",
	'cp scripts/a.ts /tmp/notes.md',
	"sed -i '' 's/a/b/' scripts/a.ts",
	'mv /tmp/notes.md scripts/a.ts',
	'rsync -a ../6688/scripts/ scripts/',
	'tar -czf notes.tgz scripts',
	'echo plan > "notes.md"',
	'echo plan >> /tmp/issue-body.md',
	'echo plan | tee -a notes.md',
	'cat app.ts 2>&1',
	"printf '%s' 'run `josh gate` with $(cmd) and FOO=1'",
]

const REFUSED: ReadonlyArray<readonly [string, string]> = [
	['git push --force', GIT_PUSH],
	['gh api -X PATCH repos/owner/repo/issues/1', GH_API_WRITE],
	['rm -rf scripts/', '`rm` to a runtime path'],
	['pnpm josh git -y', '`josh git`, a shared-state write'],
	['pnpm install', INSTALL],
	['gh pr checkout 123', '`gh pr checkout`'],
	['git diff --output=app.ts', 'writes a file'],
	['git -c core.fsmonitor=custom-editor status', 'rewrites its configuration'],
	['echo git push | sh', STDIN_SHELL],
	['cat notes.sh | bash -s arg', STDIN_SHELL],
]

const NESTED_REFUSED = [
	'echo "$(git push)"',
	'echo `git push`',
	'echo "$(echo "$(git push)")"',
	'echo x | xargs git push',
	'find . -exec git push \\;',
	"sh -c 'git push'",
	'bash -c "git push origin main"',
	'eval git push',
	'for b in a; do git push; done',
	'true && git push',
	'if git diff --quiet; then git push; fi',
	'if true; then true; else git push; fi',
	'{ git push; }',
	'! git push',
	'(cd ../x && git push)',
	"git 'push' origin main",
	'"git" push',
	'env -i git push',
	'while true; do git push; done',
]

const OTHER_REFUSED: ReadonlyArray<readonly [string, string]> = [
	["pnpm 'install'", INSTALL],
	['npm version patch', '`version`, a dependency change'],
	['gh ssh-key add key.pub', '`gh ssh-key add`'],
	['gh pr revert 12', '`gh pr revert`'],
	['gh project item-add 1 --owner o', '`gh project item-add`'],
	['gh api graphql -F query=@q.graphql', GH_API_WRITE],
	['gh api graphql --input q.json', GH_API_WRITE],
	['cp /tmp/x.ts ../6688/scripts/hooks/foo.ts', '`cp` to a runtime path'],
	['mv notes.md ../6688/scripts/a.ts', '`mv` to a runtime path outside'],
	["sed -i '' 's/a/b/' ../6688/scripts/a.ts", '`sed` to a runtime path outside'],
	["perl -pi -e 's/a/b/' /tmp/6688/scripts/a.ts", '`perl` to a runtime path outside'],
	["cd ../6688 && sed -i '' 's/a/b/' notes.md", CD_WRITE],
	// joshuafolkken/kit#6586 review round 2: an unread compound body and the other outside writers.
	// joshuafolkken/kit#7334 / #7340: the segment cut reads a `case` arm and a `{` function body, so the
	// write in it is named; a body the cut leaves unread is still refused.
	['case x in a) git push ;; esac', GIT_PUSH],
	['case x in a|b) git push ;; esac', GIT_PUSH],
	['case x in a ) git push ;; esac', GIT_PUSH],
	['case x in a) ls;; b) cp /tmp/a ../6688/scripts/a.ts;; esac', '`cp` to a runtime path outside'],
	// An arm whose command touches its `)` is not cut, so it is refused as unread.
	['case x in a) ls;; b)git push;; esac', UNREAD_BODY],
	['case x in\na) ls;;\nb)git push;;\nesac', UNREAD_BODY],
	['case x in a) ls;; b|c)git push;; esac', UNREAD_BODY],
	['case x in a) ls;; (b)git push;; esac', UNREAD_BODY],
	['f() { git push; }; f', '`git push`, a git write'],
	['function f { git push; }; f', GIT_PUSH],
	['function f() { npm --prefix web install; }; f', INSTALL],
	['f() ( git push ); f', UNREAD_BODY],
	['function f ( git push ); f', UNREAD_BODY],
	['rsync -a /tmp/x/ ../6688/scripts/', '`rsync` to a runtime path outside'],
	['install /tmp/a ../6688/scripts/a.ts', '`install` to a runtime path outside'],
	['dd if=/tmp/a of=../6688/scripts/a.ts', '`dd` to a runtime path outside'],
	['patch -d ../6688 -p1 -i /tmp/x.diff', '`patch` to a runtime path outside'],
	['tar -xf /tmp/a.tar -C ../6688', '`tar` to a runtime path outside'],
	['cd ../6688 && rsync -a /tmp/x/ scripts/', CD_WRITE],
]

const WRITE_REFUSED: ReadonlyArray<readonly [string, string]> = [
	['echo changed > notes.ts', 'redirect to `notes.ts`'],
	['echo changed >> app.ts', REDIRECT_APP],
	['echo changed >|app.ts', REDIRECT_APP],
	['printf changed > notes.md > app.ts', REDIRECT_APP],
	['printf changed > "$DESTINATION"', 'redirect to `"$DESTINATION"`'],
	['echo changed >& app.ts', REDIRECT_APP],
	['cat <>app.ts', REDIRECT_APP],
	['echo "$(printf changed > app.ts)"', REDIRECT_APP],
	['echo changed | tee notes.ts', '`tee` to a runtime path'],
	['touch app.ts', '`touch` to a runtime path'],
	['cat <<EOT > notes.ts\nchanged\nEOT', 'a heredoc'],
	['', 'an empty command'],
	['cd scripts && echo changed > notes.md', CD_WRITE],
	['cd scripts && echo changed | tee notes.md', CD_WRITE],
	['for f in app.ts; do echo x > $f; done', 'redirect to `$f`'],
	['for f in a; do grep -n x $f; done > app.ts', REDIRECT_APP],
	['time -o app.ts grep -n x notes.md', 'a time output file'],
]

describe('implementation_shell — the calls that run', () => {
	it.each(ISSUE_REPRODUCTIONS)('runs the issue reproduction %s', (command) => {
		expect(implementation_shell.refusal(command)).toBeUndefined()
	})

	it.each(RUNS)('runs %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(false)
	})
})

describe('implementation_shell — the irreversible calls', () => {
	it.each(REFUSED)('refuses %s, naming %s', (command, rule) => {
		expect(implementation_shell.refusal(command)).toContain(rule)
	})

	it.each(NESTED_REFUSED)('refuses the nested push in %s', (command) => {
		expect(implementation_shell.refusal(command)).toContain(GIT_PUSH)
	})

	it.each(OTHER_REFUSED)('refuses the bypass %s, naming %s', (command, rule) => {
		expect(implementation_shell.refusal(command)).toContain(rule)
	})
})

describe('implementation_shell — a visible write to a runtime path', () => {
	it.each(WRITE_REFUSED)('refuses the write %s, naming %s', (command, rule) => {
		expect(implementation_shell.refusal(command)).toContain(rule)
	})
})
