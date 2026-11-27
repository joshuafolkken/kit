import { describe, expect, it } from 'vitest'
import { producer_checkpoint } from './producer-checkpoint'

const COMMIT = 'git commit -m "WIP checkpoint: theme colors"'

describe('producer_checkpoint.allows', () => {
	it.each([
		COMMIT,
		`git add -A && LEFTHOOK=0 ${COMMIT}`,
		`LEFTHOOK=0 git commit --no-verify --message 'WIP checkpoint: x'`,
		'git merge --ff-only wip/theme',
		'git merge main',
		'git branch wip/theme',
		'git branch -f wip/theme HEAD',
		`git status --short && ${COMMIT}`,
	])('allows `%s`', (command) => {
		expect(producer_checkpoint.allows(command)).toBe(true)
	})

	it.each([
		['a final subject', 'git commit -m "Add theme colors"'],
		['a commit with no message flag', 'git commit'],
		['a push beside the checkpoint', `${COMMIT} && git push`],
		['a pull request', 'gh pr create --fill'],
		['a git global option', 'git -C ../main commit -m "WIP checkpoint: x"'],
		['a `cd` beside it', `cd ../main && ${COMMIT}`],
		['a branch delete', 'git branch -D wip/theme'],
		['a branch outside `wip/`', 'git branch -f main HEAD'],
		['a substitution', 'git commit -m "WIP checkpoint: $(cat x)"'],
		['a write beside it', `${COMMIT} && printf x > notes.txt`],
		['a read alone', 'git status'],
	])('refuses %s', (_name, command) => {
		expect(producer_checkpoint.allows(command)).toBe(false)
	})
})
