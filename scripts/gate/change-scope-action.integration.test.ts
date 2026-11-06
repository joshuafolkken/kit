import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { expect, it, onTestFinished } from 'vitest'

const SCRIPT = package_path('scripts/gate/change-scope-action.ts')
const MANIFEST = 'package.json'
const SKIPPED = 'runtime=false\npublish=false\n'

function git(root: string, args: Array<string>): string {
	return execFileSync(
		'/usr/bin/git',
		['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
		{ cwd: root, encoding: 'utf8' },
	).trim()
}

function repository(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'change-scope-action-'))

	onTestFinished(() => {
		rmSync(root, { recursive: true, force: true })
	})
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
		env: { ...process.env, CHANGE_BASE: base, CHANGE_HEAD: 'HEAD', GITHUB_OUTPUT: output },
	})
}

it('classifies Git history and writes the action output for a version-only bump', () => {
	const root = repository()
	const base = git(root, ['rev-parse', 'HEAD'])

	writeFileSync(path.join(root, MANIFEST), JSON.stringify({ version: '1.0.1', files: ['src'] }))
	git(root, ['commit', '--quiet', '-am', 'Bump version'])

	expect(run(root, base)).toBe(SKIPPED)
	expect(readFileSync(path.join(root, 'outputs'), 'utf8')).toBe(SKIPPED)
})

it('fails instead of skipping checks when the base revision cannot be read', () => {
	const root = repository()

	expect(() => run(root, 'missing-revision')).toThrow()
})
