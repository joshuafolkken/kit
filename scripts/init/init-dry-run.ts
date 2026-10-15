import { createHash } from 'node:crypto'
import {
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { resolve_tsx_runner } from '#scripts/josh/josh-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { execaSync } from 'execa'
import { init_bootstrap } from './init-bootstrap'
import { init_dry_run_report, type FileChange } from './init-dry-run-report'
import { init_install } from './init-install'
import { PACKAGE_DIR, package_path } from './init-paths'
import { project_profile, type ProjectProfile } from './project-profile'
import { start_exec } from './start-exec'

// `josh init --dry-run` and `josh start --dry-run` answer "what would the setup change?" without
// a second copy of the setup's decisions: the real `josh init` runs on a scratch copy of the project,
// and the plan is the difference it left there. Every create, merge and skip is decided by the code
// that decides it for real, so the plan cannot drift from the run (#3830).

interface DryRunRequest {
	root: string
	profile: ProjectProfile | undefined
	// Whether the setup meets a repository — `josh start` creates one before its setup runs.
	has_git: boolean
	is_install: boolean
}

interface DryRunSplit {
	is_dry_run: boolean
	rest: ReadonlyArray<string>
}

const DRY_RUN_FLAG = '--dry-run'
const INIT_SCRIPT = 'scripts/init/init.ts'
const SCRATCH_PREFIX = 'josh-init-dry-run-'
const DEFAULT_BRANCH = 'main'
const TITLE = 'josh init --dry-run — nothing was written. The setup would:'

function split_dry_run_flag(args: ReadonlyArray<string>): DryRunSplit {
	return {
		is_dry_run: args.includes(DRY_RUN_FLAG),
		rest: args.filter((argument) => argument !== DRY_RUN_FLAG),
	}
}

// A directory is copied unless the project scan skips it: an ignored one, or a link — followed, a
// link to the project or an ancestor would copy it into itself until the path is too long.
function is_copied_directory(source: string): boolean {
	return (
		!lstatSync(source).isSymbolicLink() &&
		!project_profile.is_ignored_directory(path.basename(source))
	)
}

// A link to a file is copied as the file it points to, so no write in the scratch copy can follow a
// link back into the project; a dangling one is left out, as the project scan leaves out what it
// cannot read. The root itself is always copied: `cpSync` filters it too, so a project in a
// directory named `build` or `dist` would otherwise be planned as an empty one.
function is_copied(root: string, source: string): boolean {
	if (source === root) return true
	if (!existsSync(source)) return false

	return !statSync(source).isDirectory() || is_copied_directory(source)
}

// The scratch repository answers the setup's git questions as the project's does: one exists, and
// its origin is the same URL, so a GitHub project is planned as one.
function mirror_git(root: string, scratch: string): void {
	start_exec.git_succeeds(['init', '--quiet', `--initial-branch=${DEFAULT_BRANCH}`], scratch)
	const origin = git_spawn_sync.origin_url(root)

	if (origin !== undefined) start_exec.git_succeeds(['remote', 'add', 'origin', origin], scratch)
}

function prepare_scratch(root: string, has_git: boolean): string {
	const scratch = mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX))

	// A copy-on-write clone where the file system supports one, so mirroring a large project costs
	// next to nothing there; a plain copy elsewhere.
	cpSync(root, scratch, {
		recursive: true,
		dereference: true,
		mode: constants.COPYFILE_FICLONE,
		filter: (source) => is_copied(root, source),
	})
	if (has_git) mirror_git(root, scratch)

	return scratch
}

function digest_of(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// A snapshot holds each file's digest, not its content, so a project with large files is compared
// without holding them in memory; only the files the setup changed are read in full.
function snapshot(root: string): Map<string, string> {
	const files = project_profile.list_files(root)

	return new Map(files.map((file) => [path.relative(root, file), digest_of(file)]))
}

function content_of(
	root: string,
	file: string,
	digests: ReadonlyMap<string, string>,
): string | undefined {
	return digests.has(file) ? readFileSync(path.join(root, file), 'utf8') : undefined
}

// The project itself still holds what the scratch copy held before the setup ran.
function changes_since(
	request: DryRunRequest,
	scratch: string,
	before: ReadonlyMap<string, string>,
): Array<FileChange> {
	const after = snapshot(scratch)

	return init_dry_run_report.changed_files(before, after).map((change) => ({
		path: change.path,
		before: content_of(request.root, change.path, before),
		after: content_of(scratch, change.path, after),
	}))
}

// `--no-install` keeps the install out of the scratch copy, and the hand-off variable keeps this
// kit doing the setup itself — the scratch copy has no kit of its own to hand it to.
function run_init(scratch: string, profile: ProjectProfile | undefined): void {
	const runner = resolve_tsx_runner()
	const profile_args = profile === undefined ? [] : ['--profile', profile]
	const args = [package_path(INIT_SCRIPT), init_install.NO_INSTALL_FLAG, ...profile_args]
	const result = execaSync(runner.executable, [...runner.leading_arguments, ...args], {
		cwd: scratch,
		env: { [init_bootstrap.HANDOFF_ENV]: '1' },
		all: true,
		reject: false,
	})

	if (result.exitCode !== 0) throw new Error(`the simulated josh init failed:\n${result.all}`)
}

function simulate(request: DryRunRequest): Array<FileChange> {
	const scratch = prepare_scratch(request.root, request.has_git)

	try {
		const before = snapshot(scratch)

		run_init(scratch, request.profile)

		return changes_since(request, scratch, before)
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
}

// The same two questions the real run asks: whether to install at all, and whether this kit is the
// project's own or hands the setup to the one it installs.
function dependency_lines(root: string, is_install: boolean): Array<string> {
	if (!is_install) return [`skip the install and the format (${init_install.NO_INSTALL_FLAG})`]
	const steps = `run ${init_install.INSTALL_STEP.label}, then ${init_install.FORMAT_STEP.label}`

	if (init_bootstrap.is_project_kit(PACKAGE_DIR, root)) return [steps]

	return [`install ${KIT_PACKAGE_NAME} into the project and hand the setup to its josh init`, steps]
}

function plan_report(request: DryRunRequest, title: string = TITLE): string {
	const changes = simulate(request)

	return init_dry_run_report.format_report(
		title,
		changes,
		dependency_lines(request.root, request.is_install),
	)
}

const init_dry_run = { DRY_RUN_FLAG, split_dry_run_flag, plan_report }
export { init_dry_run }
export type { DryRunRequest }
