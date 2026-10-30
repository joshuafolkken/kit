import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const is_cli_available =
	process.platform === 'darwin' && spawnSync('codex', ['--version']).status === 0
const ROOTS: Array<string> = []
const PROBE = String.raw`
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [root] = process.argv.slice(1);
const git = args => execFileSync('git', args, {encoding:'utf8'}).trim();
const detached = path.join(root, 'verification tree');
git(['worktree', 'add', '--quiet', '--detach', detached, 'HEAD']);
const own = execFileSync('git', ['rev-parse', '--absolute-git-dir'],
  {cwd:detached, encoding:'utf8'}).trim();
fs.writeFileSync(path.join(own, 'FETCH_HEAD'), 'fixture');
fs.writeFileSync(path.join(own, 'josh-pr-body.md'), 'fixture');
git(['worktree', 'remove', '--force', detached]);
git(['worktree', 'add', '--quiet', '--detach', detached, 'HEAD']);
git(['worktree', 'remove', '--force', detached]);
const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='],
  {encoding:'utf8'}).trim().split('\n');
const ownRow = rows.map(row => row.trim().split(/\s+/)).find(row => Number(row[0]) === process.pid);
const rss = ownRow?.[2];
execFileSync('/usr/bin/time', ['-l', process.execPath, '-e', ''], {stdio:'pipe'});
const nested = execFileSync('codex', ['sandbox', '-P', ':workspace', '--',
  process.execPath, '-e', 'process.stdout.write("nested-ok")'], {encoding:'utf8'});
process.stdout.write(JSON.stringify({removed:!fs.existsSync(detached), rss:Number(rss), nested}));
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

function probe(cwd: string, root: string): string {
	const result = spawnSync(
		'codex',
		['sandbox', '-C', cwd, ...permissions(cwd), '--', process.execPath, '-e', PROBE, root],
		{ encoding: 'utf8' },
	)

	expect(result.status, result.stderr).toBe(0)

	return result.stdout
}

// Real operations catch restrictions an argv assertion cannot observe (joshuafolkken/kit#5438).
describe.skipIf(!is_cli_available)('Codex worktree sandbox regression', () => {
	it('creates, reuses and removes verification trees, measures RSS and nests a sandbox', () => {
		const lane = worktree()
		const result: unknown = JSON.parse(probe(lane, path.dirname(lane)))

		expect(result).toMatchObject({ removed: true, nested: 'nested-ok' })
		expect(result).toHaveProperty(
			'rss',
			expect.toSatisfy((rss: number) => rss > 0),
		)
	})
})
