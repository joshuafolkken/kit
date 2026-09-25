import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build_bin } from '#scripts/build/build-bin'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { josh_cli_fixture, type JoshLauncher } from '#scripts/josh/josh-cli-fixture'

// Most defects reach a run at an environment boundary rather than inside a function
// (joshuafolkken/kit#2447): a consumer without `docs/` (#2402), a lane worktree whose ledger lives in
// the primary checkout (#2419), two processes racing on one marker (#2434). Unit tests call functions
// inside this checkout, so none of those boundaries exists for them. Each environment here is a real
// directory in the system temp dir, assembled the way a run meets it, and josh is spawned into it as a
// subprocess — so a test asserts on the exit code, the output and the files the command left behind.
//
// **Every environment is gate-green on its own.** The toolchain files below are the least a project
// needs for `josh gate` to pass in a few seconds, and `node_modules` is this checkout's, linked rather
// than installed — so a scenario can run the real gate, not a stand-in for it.

type EnvironmentKind = 'consumer' | 'kit' | 'lane' | 'packed'

interface JoshEnvironment {
	kind: EnvironmentKind
	// Where the commands run — the lane checkout for a lane, the project root otherwise.
	root: string
	// The primary checkout: the same directory as `root` everywhere but a lane.
	primary: string
	launcher: JoshLauncher
	// The temp directory that holds everything above, removed whole on close.
	workspace: string
}

const PACKAGE_NAME = '@joshuafolkken/kit'
const PRIMARY_DIRECTORY = 'primary'
const LANE_DIRECTORY = 'lane'
const LANE_BRANCH = 'lane'
const NODE_MODULES = 'node_modules'
const JOSH_BIN = 'josh'
const PACKAGE_JSON = 'package.json'
const WORKSPACE_PREFIX = 'josh-harness-'
const JSON_INDENT = '\t'
// pnpm 11 fails an install whose dependencies carry build scripts nobody approved; the throwaway
// consumer approves none, and the smoke needs none of them run.
const NON_STRICT_BUILDS = '--config.strict-dep-builds=false'

function json_file(value: unknown): string {
	return `${JSON.stringify(value, undefined, JSON_INDENT)}\n`
}

// A command josh runs inside the environment — the gate's `pnpm josh lint` and the rest — must reach
// this checkout's source, as the kit's own `josh` script and a consumer's installed bin do. Without the
// script it fell through to whatever `josh` was on PATH: a global install locally, nothing at all in CI.
// The kit's `packageManager` goes with it, so Corepack runs the pinned pnpm rather than fetching the latest.
function launch_command(launcher: JoshLauncher): string {
	return [launcher.executable, ...launcher.leading_arguments]
		.map((part) => JSON.stringify(part))
		.join(' ')
}

function kit_package_manager(): string {
	const manifest = readFileSync(path.join(josh_cli_fixture.REPO_ROOT, PACKAGE_JSON), 'utf8')

	return (JSON.parse(manifest) as { packageManager: string }).packageManager
}

const PROJECT_FIELDS = {
	private: true,
	type: 'module',
	packageManager: kit_package_manager(),
	scripts: { josh: launch_command(josh_cli_fixture.SOURCE_JOSH) },
}

// A file the fixture writes: its path relative to the project root, and its content.
type FixtureFile = readonly [string, string]

const TOOLCHAIN_FILES: ReadonlyArray<FixtureFile> = [
	['.gitignore', 'node_modules\n.*cache\n.tsbuildinfo\npnpm-lock.yaml\n'],
	['.prettierignore', '*.json\npnpm-lock.yaml\n'],
	['.prettierrc', json_file({ semi: false, singleQuote: true, useTabs: true })],
	[
		'cspell.config.yaml',
		// `package.json` is skipped because its `josh` script carries this checkout's absolute paths.
		'words:\n  - joshuafolkken\nignorePaths:\n  - .git\n  - node_modules\n  - .tsbuildinfo\n  - .*cache\n  - package.json\n  - pnpm-lock.yaml\n',
	],
	['eslint.config.js', 'export default [{}]\n'],
	[
		'sample.test.ts',
		"import { expect, it } from 'vitest'\n\nit('passes', () => {\n\texpect(1).toBe(1)\n})\n",
	],
	[
		'tsconfig.json',
		json_file({
			compilerOptions: { strict: true, noEmit: true, module: 'nodenext', types: [] },
			include: ['*.ts'],
		}),
	],
]

// The kit's own shape: its package name, so josh treats the directory as the kit rather than a
// consumer, and the `docs/` and `prompts/` directories only the kit carries.
const KIT_FILES: ReadonlyArray<FixtureFile> = [
	...TOOLCHAIN_FILES,
	[PACKAGE_JSON, json_file({ name: PACKAGE_NAME, version: '0.0.0', ...PROJECT_FIELDS })],
	['docs/README.md', '# Docs\n'],
	['prompts/README.md', '# Prompts\n'],
]

// The least a consumer is: a project that depends on the kit and carries neither `docs/` nor
// `prompts/` — the shape #2402's ENOENT needed.
const CONSUMER_FILES: ReadonlyArray<FixtureFile> = [
	...TOOLCHAIN_FILES,
	[
		PACKAGE_JSON,
		json_file({
			name: 'kit-consumer',
			version: '0.0.0',
			...PROJECT_FIELDS,
			devDependencies: { [PACKAGE_NAME]: '*' },
		}),
	],
]

// Resolved through `realpath` because a child's `process.cwd()` is: on macOS the temp dir is a
// symlink, and a path the test built would not match the one the command printed or keyed a record on.
function open_workspace(): string {
	const workspace = mkdtempSync(path.join(tmpdir(), WORKSPACE_PREFIX))

	return realpathSync(workspace)
}

function write_files(directory: string, files: ReadonlyArray<FixtureFile>): void {
	for (const [relative_path, content] of files) {
		const file = path.join(directory, relative_path)

		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, content, 'utf8')
	}
}

function link_toolchain(directory: string): void {
	symlinkSync(
		path.join(josh_cli_fixture.REPO_ROOT, NODE_MODULES),
		path.join(directory, NODE_MODULES),
		'dir',
	)
}

async function assemble(directory: string, files: ReadonlyArray<FixtureFile>): Promise<void> {
	const { git, MAIN_BRANCH } = git_fixture_workspace

	write_files(directory, files)
	link_toolchain(directory)
	await git(directory, ['init', MAIN_BRANCH])
	await git(directory, ['add', '-A'])
	await git(directory, ['commit', '-m', 'fixture'])
}

// A lane is a `git worktree` of the primary checkout, as `josh lane` makes one. `node_modules` is
// ignored, so the worktree gets its own link rather than inheriting one.
async function add_lane(primary: string, lane: string): Promise<string> {
	await git_fixture_workspace.git(primary, ['worktree', 'add', lane, '-b', LANE_BRANCH])
	link_toolchain(lane)

	return lane
}

// A setup that throws returns no environment, so nothing would ever close its workspace — it is
// removed here before the error travels on.
async function in_workspace<T>(build: (workspace: string) => T | Promise<T>): Promise<T> {
	const workspace = open_workspace()

	try {
		return await build(workspace)
	} catch (error) {
		rmSync(workspace, { recursive: true, force: true })
		throw error
	}
}

async function assemble_environment(
	kind: Exclude<EnvironmentKind, 'packed'>,
	workspace: string,
): Promise<JoshEnvironment> {
	const primary = path.join(workspace, PRIMARY_DIRECTORY)

	await assemble(primary, kind === 'consumer' ? CONSUMER_FILES : KIT_FILES)
	const root =
		kind === 'lane' ? await add_lane(primary, path.join(workspace, LANE_DIRECTORY)) : primary

	return { kind, root, primary, launcher: josh_cli_fixture.SOURCE_JOSH, workspace }
}

async function open_environment(
	kind: Exclude<EnvironmentKind, 'packed'>,
): Promise<JoshEnvironment> {
	return await in_workspace(async (workspace) => await assemble_environment(kind, workspace))
}

function pack_into(directory: string): string {
	const pack_output = execFileSync(
		'pnpm',
		['pack', '--json', '--pack-destination', directory, '--config.ignore-scripts=true'],
		{ cwd: josh_cli_fixture.REPO_ROOT, encoding: 'utf8' },
	)
	const { filename } = JSON.parse(pack_output) as { filename: string }

	// pnpm 11 reports the tarball's absolute path, earlier versions its bare name; `resolve` takes both.
	return path.resolve(directory, filename)
}

// The published package rather than the source: the real tarball packed and installed into a bare
// consumer, and josh run through the `node_modules/.bin` shim that install writes — the command a
// consumer types. Not `resolve_package_bin`: the kit's `exports` map does not export its
// `package.json`, so that route answers nothing for the kit itself. Slow (~60 s), so its suite stays
// out of the unit gate.
function install_packed(workspace: string): JoshEnvironment {
	writeFileSync(
		path.join(workspace, PACKAGE_JSON),
		json_file({ name: 'test-consumer', version: '1.0.0' }),
	)
	const tarball = pack_into(workspace)

	execFileSync('pnpm', ['add', NON_STRICT_BUILDS, tarball], { cwd: workspace, encoding: 'utf8' })
	const shim = resolve_local_bin(workspace, JOSH_BIN)
	if (!existsSync(shim)) throw new Error(`josh bin not found after installing ${tarball}`)

	const launcher: JoshLauncher = { executable: shim, leading_arguments: [] }

	return { kind: 'packed', root: workspace, primary: workspace, launcher, workspace }
}

async function open_packed_consumer(): Promise<JoshEnvironment> {
	await build_bin()

	return await in_workspace(install_packed)
}

function close_environment(environment: JoshEnvironment): void {
	rmSync(environment.workspace, { recursive: true, force: true })
}

const josh_harness_environment = {
	close_environment,
	in_workspace,
	open_environment,
	open_packed_consumer,
}

export type { EnvironmentKind, JoshEnvironment }
export { josh_harness_environment }
