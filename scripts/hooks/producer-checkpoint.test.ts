import { describe, expect, it } from 'vitest'
import { producer_checkpoint } from './producer-checkpoint'

const CHECKPOINT = 'pnpm josh git:checkpoint theme "theme colors"'

describe('producer_checkpoint.allows', () => {
	it.each([
		CHECKPOINT,
		'pnpm josh git:checkpoint theme-2 x',
		'git merge --ff-only wip/theme',
		'git merge main',
		`git status --short && ${CHECKPOINT}`,
	])('allows `%s`', (command) => {
		expect(producer_checkpoint.allows(command)).toBe(true)
	})

	it.each([
		['a raw commit', 'git commit -m "WIP checkpoint: theme colors"'],
		['a raw add and commit', 'git add -A && LEFTHOOK=0 git commit -m "WIP checkpoint: x"'],
		['a raw branch move', 'git branch -f wip/theme HEAD'],
		['a push beside the checkpoint', `${CHECKPOINT} && git push`],
		['a pull request', 'gh pr create --fill'],
		['a git global option on a merge', 'git -C ../main merge main'],
		['a `cd` beside it', `cd ../main && ${CHECKPOINT}`],
		['another josh command', 'pnpm josh git -y'],
		['a substitution', 'pnpm josh git:checkpoint theme "$(cat x)"'],
		['a write beside it', `${CHECKPOINT} && printf x > notes.txt`],
		['a read alone', 'git status'],
	])('refuses %s', (_name, command) => {
		expect(producer_checkpoint.allows(command)).toBe(false)
	})
})
