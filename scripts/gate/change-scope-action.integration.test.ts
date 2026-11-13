import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

// cspell:words gpgsign
const SCRIPT = fileURLToPath(new URL('change-scope-action.ts', import.meta.url))
const MANIFEST = 'package.json'
const RELEASED = 'runtime=false\npublish=true\n'
const ENVIRONMENT = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
)

function git(root: string, args: Array<string>): string {
	return execFileSync(
		'/usr/bin/git',
		[
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.com',
			'-c',
			'commit.gpgsign=false',
			...args,
		],
		{ cwd: root, encoding: 'utf8', env: ENVIRONMENT },
	).trim()
}

function repository(): string {
	// Distributed tests cannot import kit's unpublished tools/test helper; cleanup is registered below.
	// eslint-disable-next-line no-restricted-syntax
	const root = mkdtempSync(path.join(tmpdir(), 'change-scope-action-'))

	onTestFinished(() => rmSync(root, { recursive: true, force: true }))

	git(root, ['init', '--quiet'])
	writeFileSync(path.join(root, MANIFEST), JSON.stringify({ version: '1.0.0', files: ['src'] }))
	git(root, ['add', MANIFEST])
	git(root, ['commit', '--quiet', '-m', 'Initial manifest'])

	return root
}

function run(root: string, base: string): string {
	const output = path.join(root, 'outputs')

	return execFileSync(process.execPath, [SCRIPT], {
		cwd: root,
		encoding: 'utf8',
		env: { ...ENVIRONMENT, CHANGE_BASE: base, CHANGE_HEAD: 'HEAD', GITHUB_OUTPUT: output },
	})
}

it('classifies Git history and writes the action output for a version-only bump', () => {
	const root = repository()
	const base = git(root, ['rev-parse', 'HEAD'])

	writeFileSync(path.join(root, MANIFEST), JSON.stringify({ version: '1.0.1', files: ['src'] }))
	git(root, ['commit', '--quiet', '-am', 'Bump version'])

	expect(run(root, base)).toBe(RELEASED)
	expect(readFileSync(path.join(root, 'outputs'), 'utf8')).toBe(RELEASED)
})

it('fails instead of skipping checks when the base revision cannot be read', () => {
	const root = repository()

	expect(() => run(root, 'missing-revision')).toThrow()
})

it.each([
	['source.ts', 'runtime=true\npublish=false\n'],
	['README.md', RELEASED],
	['pnpm-lock.yaml', 'runtime=true\npublish=true\n'],
])('classifies committed %s through the local action (ac-c3170ba1)', (name, expected) => {
	const root = repository()
	const base = git(root, ['rev-parse', 'HEAD'])

	writeFileSync(path.join(root, name), 'changed\n')
	git(root, ['add', name])
	git(root, ['commit', '--quiet', '-m', 'Change input'])

	expect(run(root, base)).toBe(expected)
	expect(readFileSync(path.join(root, 'outputs'), 'utf8')).toBe(expected)
})
