import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'

const GIT_INIT_TIMEOUT_MS = 10_000

interface HookResult {
	status: number | null
	stdout: string
	stderr: string
}

interface CheckoutOptions {
	git_overrides?: Record<string, string>
	is_external_git?: boolean
}

function create_partial_install(temporary_root: string): void {
	const package_root = path.join(temporary_root, 'node_modules/@joshuafolkken/kit')
	const hook_path = path.join(package_root, 'dist/hooks/pretool-guard.js')

	mkdirSync(path.dirname(hook_path), { recursive: true })
	writeFileSync(path.join(package_root, 'package.json'), '{}')
	writeFileSync(hook_path, "process.stdout.write('guard ran')")
}

function execution_directory(temporary_root: string, is_nested: boolean): string {
	if (!is_nested) return temporary_root

	const nested_root = path.join(temporary_root, 'src')

	mkdirSync(nested_root)

	return nested_root
}

// A failed or hung `git init` would leave the hook running outside a checkout, so every case after it
// would assert against the wrong setup; it is bounded and refused rather than ignored.
function initialize_repository(
	git_arguments: ReadonlyArray<string>,
	temporary_root: string,
	git_environment: NodeJS.ProcessEnv,
): void {
	const result = spawnSync('git', git_arguments, {
		cwd: temporary_root,
		encoding: 'utf8',
		env: git_environment,
		timeout: GIT_INIT_TIMEOUT_MS,
	})

	if (result.status !== 0) {
		throw new Error(
			`git ${git_arguments.join(' ')} failed: ${result.error?.message ?? result.stderr}`,
		)
	}
}

function checkout_environment(temporary_root: string, options: CheckoutOptions): NodeJS.ProcessEnv {
	const metadata_root = path.join(temporary_root, 'metadata')
	const git_environment = {
		...process.env,
		...git_location_environment.location_free_environment(),
	}
	const git_arguments = options.is_external_git
		? ['init', '--bare', '-q', metadata_root]
		: ['init', '-q']

	initialize_repository(git_arguments, temporary_root, git_environment)

	if (options.is_external_git) {
		return { ...git_environment, GIT_DIR: metadata_root, GIT_WORK_TREE: temporary_root }
	}

	return { ...git_environment, ...options.git_overrides }
}

function run_in_temporary_checkout(
	command: string,
	is_partial_install = false,
	is_nested = false,
	options: CheckoutOptions = {},
): HookResult {
	const temporary_root = mkdtempSync(path.join(tmpdir(), 'kit-hook-bootstrap-'))

	try {
		const hook_environment = checkout_environment(temporary_root, options)

		if (is_partial_install) create_partial_install(temporary_root)

		const { status, stdout, stderr } = spawnSync('sh', ['-c', command], {
			cwd: execution_directory(temporary_root, is_nested),
			encoding: 'utf8',
			env: hook_environment,
		})

		return { status, stdout, stderr }
	} finally {
		rmSync(temporary_root, { recursive: true, force: true })
	}
}

const hook_command_bootstrap = { initialize_repository, run_in_temporary_checkout }

export { hook_command_bootstrap }
