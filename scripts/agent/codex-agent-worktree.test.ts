import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const is_cli_available =
	process.platform === 'darwin' && spawnSync('codex', ['--version']).status === 0
const FETCH_HEAD = 'FETCH_HEAD'
const PR_BODY = 'josh-pr-body.md'
const PROTECTED = ['hooks/pre-commit', 'config', 'commondir', 'config.worktree']
const CONTENT = 'sandbox regression\n'
const ROOTS: Array<string> = []
const PROBE = `
const fs = require('node:fs');
const path = require('node:path');
const [root, content, ...entries] = process.argv.slice(1);
const results = entries.map(entry => {
  try { fs.mkdirSync(path.dirname(path.join(root, entry)), {recursive:true});
    fs.writeFileSync(path.join(root, entry), content); return 'write'; }
  catch (error) { return error.code; }
});
process.stdout.write(JSON.stringify(results));
`

afterEach(() => {
	for (const root of ROOTS.splice(0)) rmSync(root, { force: true, recursive: true })
})

function git(cwd: string, args: ReadonlyArray<string>): string {
	return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function worktree(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'codex-worktree-'))
	const lane = path.join(root, 'lane with spaces')

	ROOTS.push(root)
	git(root, ['init', '--quiet'])
	git(root, [
		'-c',
		'user.name=Test',
		'-c',
		'user.email=test@example.com',
		'-c',
		'core.hooksPath=/dev/null',
		'commit',
		'--quiet',
		'--allow-empty',
		'-m',
		'Fixture',
	])
	git(root, ['worktree', 'add', '--quiet', '--detach', lane])

	return lane
}

function sandbox_config(value: string): ReadonlyArray<string> {
	const prefix = 'default_permissions='
	if (value.startsWith(prefix)) return ['-P', String(JSON.parse(value.slice(prefix.length)))]

	return ['-c', value]
}

function permissions(cwd: string): ReadonlyArray<string> {
	const { worker } = agent_role_profile.OPENAI_PROFILES
	const { args } = codex_agent_argv.build('Sandbox regression', worker, cwd)

	return args.flatMap((value, index) =>
		value === '-c' ? sandbox_config(args[index + 1] ?? '') : [],
	)
}

function probe(cwd: string, root: string, entries: ReadonlyArray<string>): string {
	const result = spawnSync(
		'codex',
		[
			'sandbox',
			'-C',
			cwd,
			...permissions(cwd),
			'--',
			process.execPath,
			'-e',
			PROBE,
			root,
			CONTENT,
			...entries,
		],
		{ encoding: 'utf8' },
	)

	expect(result.stderr).toBe('')
	expect(result.status).toBe(0)

	return result.stdout
}

// A table assertion alone misses Codex's implicit protection of linked worktree admin directories.
describe.skipIf(!is_cli_available)('Codex worktree sandbox regression', () => {
	it('writes FETCH_HEAD and PR bodies while protecting Git execution and pointer files', () => {
		const lane = worktree()
		const own = git(lane, ['rev-parse', '--absolute-git-dir'])
		const common = git(lane, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
		const pointer = readFileSync(path.join(own, 'commondir'), 'utf8')

		expect(probe(lane, own, [FETCH_HEAD, PR_BODY])).toBe(JSON.stringify(['write', 'write']))

		for (const entry of [FETCH_HEAD, PR_BODY]) {
			expect(readFileSync(path.join(own, entry), 'utf8')).toBe(CONTENT)
		}

		expect(probe(lane, own, PROTECTED)).toBe(JSON.stringify(PROTECTED.map(() => 'EPERM')))
		expect(probe(lane, common, PROTECTED)).toBe(JSON.stringify(PROTECTED.map(() => 'EPERM')))
		expect(readFileSync(path.join(own, 'commondir'), 'utf8')).toBe(pointer)
	})
})
