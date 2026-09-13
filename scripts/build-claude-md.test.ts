import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate_distributed_claude_md, REPO_ROOT } from './build-claude-md'

const KIT_PACKAGE_PREFIX = 'node_modules/@joshuafolkken/kit/'

// Every backtick-quoted token in the transformed CLAUDE.md that looks like a path (contains a slash).
function backtick_paths(content: string): ReadonlyArray<string> {
	return [...content.matchAll(/`([^`]+)`/gu)]
		.map((match) => match[1])
		.filter((token): token is string => Boolean(token?.includes('/')))
}

function is_glob(token: string): boolean {
	return token.includes('*')
}

// Guards joshuafolkken/kit#1878: after the publish-time transform, no backtick path in the
// distributed CLAUDE.md may reference a location a consumer cannot reach. A bundled reference must
// point into node_modules and at a file the package actually ships; an unbundled one (tests, docs/)
// must be a GitHub URL. A future edit to CLAUDE.md that adds a bare kit-owned path fails here.
describe('distributed CLAUDE.md path resolvability (joshuafolkken/kit#1878)', () => {
	const content = generate_distributed_claude_md()
	const paths = backtick_paths(content)

	it('leaves no bare prompts/ or eslint/ reference — they must point into node_modules', () => {
		const bare = paths.filter(
			(reference) =>
				!is_glob(reference) &&
				(reference.startsWith('prompts/') || reference.startsWith('eslint/')),
		)

		expect(bare).toStrictEqual([])
	})

	it('leaves no bare docs/ or *.test.ts reference — they must be GitHub URLs', () => {
		const bare = paths.filter(
			(reference) =>
				!is_glob(reference) &&
				(reference.startsWith('docs/') || /\.(?:test|spec)\.ts$/u.test(reference)),
		)

		expect(bare).toStrictEqual([])
	})

	it('every node_modules/@joshuafolkken/kit/ reference points at a file the package ships', () => {
		const missing = paths
			.filter((reference) => reference.startsWith(KIT_PACKAGE_PREFIX) && !is_glob(reference))
			.map((reference) => reference.slice(KIT_PACKAGE_PREFIX.length))
			.filter((relative) => !existsSync(path.join(REPO_ROOT, relative)))

		expect(missing).toStrictEqual([])
	})

	it('actually rewrote prompts/ and eslint/ references', () => {
		expect(content).toContain(`${KIT_PACKAGE_PREFIX}prompts/`)
		expect(content).toContain(`${KIT_PACKAGE_PREFIX}eslint/`)
	})
})
