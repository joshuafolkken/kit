import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gh_subcommand_guard, type GhSpawn } from './gh-subcommand-guard'

// joshuafolkken/kit#1063: the mechanical check joshuafolkken/kit#1022's survey did not have. That
// survey counted `exec_gh_command` call sites, so a direct `execa` / `execaSync` spawn of `gh` was
// never counted and `scripts-ai/issue-prep.ts` was missed entirely. These tests fix two things: that
// the repository holds no un-allowlisted spawn, and that the scanner really does see every shape one
// can be written in — a scan that quietly matched nothing would report success exactly as the
// survey did.
//
// The fixtures below are source text handed to the parser, not code in this file, so writing a
// forbidden spawn out in full here is not itself one.

const FIXTURE_FILE = 'scripts/fixture.ts'
const SCRIPTS_DIRECTORY = 'scripts'
const SCRIPTS_AI_DIRECTORY = 'scripts-ai'
const ISSUE_PREP_FILE = 'scripts-ai/issue-prep.ts'
const GH_EXEC_FILE = 'scripts/git/git-gh-exec.ts'
const GUARD_MODULE_EXCLUSION = '!scripts/gh-subcommand-guard.ts'
const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')

function scan(source: string): Array<GhSpawn> {
	return gh_subcommand_guard.find_gh_spawns(source, FIXTURE_FILE)
}

function subcommands(source: string): Array<string> {
	return scan(source).map((spawn) => spawn.subcommand)
}

describe('gh subcommand guard — the repository as it stands', () => {
	it('spawns gh only through `gh api`, apart from the allowlisted calls', () => {
		const violations = gh_subcommand_guard
			.scan_repository()
			.filter((spawn) => !gh_subcommand_guard.is_allowed(spawn))

		expect(violations.map((spawn) => gh_subcommand_guard.describe_violation(spawn))).toStrictEqual(
			[],
		)
	})

	// The blind spot itself. `scripts-ai/` was outside joshuafolkken/kit#1042's grep, so a scan that
	// covered only `scripts/` would pass while `josh issue <N>` still spawned `gh issue view`.
	it('reads both scripts/ and scripts-ai/', () => {
		expect(gh_subcommand_guard.SCANNED_DIRECTORIES).toStrictEqual([
			SCRIPTS_DIRECTORY,
			SCRIPTS_AI_DIRECTORY,
		])
		expect(gh_subcommand_guard.source_files(SCRIPTS_AI_DIRECTORY)).toContain(ISSUE_PREP_FILE)
		expect(gh_subcommand_guard.source_files(SCRIPTS_DIRECTORY)).toContain(GH_EXEC_FILE)
	})

	// A scan that matched nothing would satisfy the assertion above without checking anything.
	it('finds the gh spawns that do exist', () => {
		const found = gh_subcommand_guard.scan_repository()

		expect(found.length).toBeGreaterThan(0)
		expect(found.map((spawn) => spawn.file)).toContain(GH_EXEC_FILE)
	})
})

describe('gh subcommand guard — the allowlist', () => {
	// A stale exemption is a hole nobody can see. Every entry must name a spawn that is really
	// there, and say why it cannot be a REST call.
	it('keeps no entry that matches nothing', () => {
		const found = gh_subcommand_guard.scan_repository()
		const unmatched = gh_subcommand_guard.ALLOWED_SPAWNS.filter((entry) =>
			found.every((spawn) => spawn.file !== entry.file || spawn.subcommand !== entry.subcommand),
		)

		expect(unmatched).toStrictEqual([])
	})

	it('gives every entry a reason', () => {
		for (const entry of gh_subcommand_guard.ALLOWED_SPAWNS) {
			expect(entry.reason.length).toBeGreaterThan(0)
		}
	})
})

describe('gh subcommand guard — the shapes a spawn is written in', () => {
	it('catches a one-line synchronous spawn', () => {
		expect(subcommands(`const r = execaSync('gh', ['issue', 'view', '42'])`)).toStrictEqual([
			'issue',
		])
	})

	it('catches an asynchronous spawn', () => {
		expect(subcommands(`await execa('gh', ['pr', 'merge'])`)).toStrictEqual(['pr'])
	})

	// The shape `propagate-steps.ts` hid from a naive grep: `'gh'` sits on its own line, so a pattern
	// anchored on `execaSync('gh'` as one string matches nothing.
	it('catches a multi-line spawn with the binary on its own line', () => {
		const source = [
			'const result = execaSync(',
			"\t'gh',",
			"\t['label', 'create', name],",
			'\t{ reject: false },',
			')',
		].join('\n')

		expect(subcommands(source)).toStrictEqual(['label'])
	})
})

describe('gh subcommand guard — spellings other than execa', () => {
	it('catches a node built-in spawn, plain and through a namespace', () => {
		expect(subcommands(`spawnSync('gh', ['repo', 'view'])`)).toStrictEqual(['repo'])
		expect(subcommands(`child_process.execFileSync('gh', ['issue', 'close'])`)).toStrictEqual([
			'issue',
		])
	})

	it('catches a whole command string', () => {
		expect(subcommands(`execSync('gh issue view 42 --json title')`)).toStrictEqual(['issue'])
	})

	it("catches execa's script tag, configured or not", () => {
		expect(subcommands('await $`gh pr merge 42`')).toStrictEqual(['pr'])
		expect(subcommands('await $({ reject: false })`gh issue close 42`')).toStrictEqual(['issue'])
	})
})

describe('gh subcommand guard — a spawn function under another name', () => {
	// The shape that hid a live `gh repo view` in `scripts-ai/telegram-test.ts` from
	// joshuafolkken/kit#1022's survey and from this guard's own first draft: the callee is neither
	// `execa` nor a node built-in, it is a local name bound to one.
	it('catches a spawn through a promisified or aliased spawn function', () => {
		const promisified = [
			`const exec_file_async = promisify(execFile)`,
			`await exec_file_async('gh', ['repo', 'view', '--json', 'nameWithOwner'])`,
		].join('\n')
		const aliased = [`const run = execaSync`, `run('gh', ['issue', 'view'])`].join('\n')

		expect(subcommands(promisified)).toStrictEqual(['repo'])
		expect(subcommands(aliased)).toStrictEqual(['issue'])
	})

	// `execa('gh', to_gh_api_args(request))` — the arguments are built elsewhere, so no first
	// argument can be read. Reported rather than skipped: "could not tell" is what let the original
	// survey pass.
	it('reports an argument list it cannot read as dynamic', () => {
		expect(subcommands(`execaSync('gh', build_args(request), options)`)).toStrictEqual([
			gh_subcommand_guard.DYNAMIC_SUBCOMMAND,
		])
		expect(subcommands(`execaSync('gh', [...prefix, 'issue'])`)).toStrictEqual([
			gh_subcommand_guard.DYNAMIC_SUBCOMMAND,
		])
	})

	it('accepts a REST call', () => {
		const source = `execaSync('gh', ['api', 'repos/o/r', '--jq', '.full_name'])`

		expect(subcommands(source)).toStrictEqual([gh_subcommand_guard.API_SUBCOMMAND])
		expect(scan(source).every((spawn) => gh_subcommand_guard.is_allowed(spawn))).toBe(true)
	})

	it('ignores a spawn of another binary', () => {
		expect(subcommands(`execaSync('git', ['status', '--short'])`)).toStrictEqual([])
	})

	// The scan keys on the spawn, never on `exec_gh_command` — counting that helper's call sites is
	// exactly the mistake being guarded against.
	it('finds a direct spawn in a file that never mentions the shared helper', () => {
		const source = `import { execa } from 'execa'\nawait execa('gh', ['issue', 'close'])`

		expect(source).not.toContain('exec_gh_command')
		expect(subcommands(source)).toStrictEqual(['issue'])
	})
})

describe('gh subcommand guard — a binary named indirectly', () => {
	// The documented limit, pinned so it stays a decision rather than becoming an oversight: a
	// binary the file cannot resolve is skipped, because reporting every one of them would need an
	// allowlist entry for each spawn here that launches pnpm, git, sh or tsx.
	it('skips a binary it cannot resolve, and still reports an unreadable argument list', () => {
		expect(subcommands(`execa(resolve_bin(), ['issue', 'edit'])`)).toStrictEqual([])
		expect(subcommands(`execa('gh', build_args())`)).toStrictEqual([
			gh_subcommand_guard.DYNAMIC_SUBCOMMAND,
		])
	})

	it('resolves a name held in a const declared after the call', () => {
		const source = [`await execa(GH, ['repo', 'view'])`, `const GH = 'gh'`].join('\n')

		expect(subcommands(source)).toStrictEqual(['repo'])
	})

	it('resolves a name held in a let, and one written as a template literal', () => {
		expect(
			subcommands([`let bin = 'gh'`, `execaSync(bin, ['issue', 'edit'])`].join('\n')),
		).toStrictEqual(['issue'])
		expect(subcommands('execaSync(`gh`, [`label`, `list`])')).toStrictEqual(['label'])
	})
})

// The first draft of this scanner blanked comments with a regex, which decided for itself what was
// code and what was not — and got it wrong in both directions. Parsing removes the question, and
// these hold that answer in place.
describe('gh subcommand guard — prose and strings are not spawns', () => {
	it('ignores a command quoted in a line comment', () => {
		expect(subcommands(`// it used to call execaSync('gh', ['issue', 'view'])`)).toStrictEqual([])
	})

	it('ignores a command quoted in a block comment', () => {
		expect(subcommands(`/* was execaSync('gh', ['label', 'create']) */`)).toStrictEqual([])
	})

	// A `/*` inside a string literal is not a comment. Reading it as one blanked everything to the
	// next `*/` — measured at hundreds of lines across 27 files, every spawn in them invisible.
	it('does not let a comment opener inside a string blind the rest of the file', () => {
		const source = [`const glob = 'src/*'`, `execaSync('gh', ['issue', 'view'])`].join('\n')

		expect(scan(source)).toStrictEqual([{ file: FIXTURE_FILE, line: 2, subcommand: 'issue' }])
	})

	it('does not let a double slash inside a string hide a spawn beside it', () => {
		const source = `const note = 'a // b'; execaSync('gh', ['pr', 'view'])`

		expect(subcommands(source)).toStrictEqual(['pr'])
	})

	it('does not lose a spawn to quotes inside a regular expression literal', () => {
		const source = [`const quoted = /['"]/u`, `execaSync('gh', ['issue', 'comment'])`].join('\n')

		expect(subcommands(source)).toStrictEqual(['issue'])
	})
})

describe('gh subcommand guard — line numbers and URLs', () => {
	it('does not read a URL as the start of a comment', () => {
		const source = [
			`const url = 'https://example.test/x'`,
			`execaSync('gh', ['issue', 'view'])`,
		].join('\n')

		expect(subcommands(source)).toStrictEqual(['issue'])
	})

	it('reports the line the spawn is written on', () => {
		const source = [
			'// one',
			`// two: execaSync('gh', ['pr', 'create'])`,
			'',
			`execaSync('gh', ['issue', 'edit'])`,
		].join('\n')

		expect(scan(source)).toStrictEqual([{ file: FIXTURE_FILE, line: 4, subcommand: 'issue' }])
	})
})

describe('gh subcommand guard — the failure message', () => {
	it('names the file, the line and the command', () => {
		const message = gh_subcommand_guard.describe_violation({
			file: ISSUE_PREP_FILE,
			line: 21,
			subcommand: 'issue',
		})

		expect(message).toContain(`${ISSUE_PREP_FILE}:21`)
		expect(message).toContain('gh issue')
	})

	it('says what to do about it', () => {
		expect(gh_subcommand_guard.GUIDANCE).toContain('exec_gh_api')
		expect(gh_subcommand_guard.GUIDANCE).toContain('ALLOWED_SPAWNS')
	})
})

// This module imports `typescript`, which is a devDependency, and it is used by nothing but the
// test above. Shipping it would put an undeclared dependency on the published surface.
describe('gh subcommand guard — what is published', () => {
	it('is excluded from the package files', () => {
		const manifest: unknown = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
		const { files } = manifest as { files: ReadonlyArray<string> }

		expect(files).toContain(GUARD_MODULE_EXCLUSION)
	})
})
