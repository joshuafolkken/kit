import { describe, expect, it } from 'vitest'
import { index_guard } from './index-guard'

// joshuafolkken/kit#2983: an index mutation in a spelling the prefix deny globs miss. The refused set
// is the Issue's acceptance criteria — a `-C` / `-c` prefix and an `env` wrapper — plus each index
// subcommand; the silent set is read-only git, the working-tree restore the sibling row owns, and the
// authorized `pnpm josh git -y` route.

describe('index_guard.is_index_mutation — refuses', () => {
	it.each([
		'git -C . commit -m "x"',
		'git -c user.name=x commit -m "x"',
		'env git commit -m "x"',
		'env GIT_EDITOR=true git commit --amend',
		'git -C /repo add .',
		'git stage src/app.ts',
		'git -C . reset --hard',
		'git -C . rm --cached src/app.ts',
		'git -C . mv a.ts b.ts',
		'git -C . restore --staged src/app.ts',
		'git restore -S src/app.ts',
		'git status && git -C . add -A',
	])('refuses %j', (command) => {
		expect(index_guard.is_index_mutation(command)).toBe(true)
	})
})

describe('index_guard.is_index_mutation — is silent on', () => {
	it.each([
		'git status',
		'git -C . diff --cached',
		'git log -1 --oneline',
		'git restore src/app.ts',
		'git restore -S -W src/app.ts',
		'pnpm josh git -y "title #1"',
		'pnpm josh dogfood:commit ~/Development/kit-test-html-start',
		'echo "git commit -m x"',
	])('%j', (command) => {
		expect(index_guard.is_index_mutation(command)).toBe(false)
	})
})
