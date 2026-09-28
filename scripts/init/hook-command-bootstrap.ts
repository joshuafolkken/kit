import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'

interface HookResult {
	status: number | null
	stdout: string
	stderr: string
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

function run_in_temporary_checkout(
	command: string,
	is_partial_install = false,
	is_nested = false,
	git_overrides: Record<string, string> = {},
): HookResult {
	const temporary_root = mkdtempSync(path.join(tmpdir(), 'kit-hook-bootstrap-'))
	const git_environment = {
		...process.env,
		...git_location_environment.location_free_environment(),
	}

	try {
		spawnSync('git', ['init', '-q'], { cwd: temporary_root, env: git_environment })

		if (is_partial_install) create_partial_install(temporary_root)
		const { status, stdout, stderr } = spawnSync('sh', ['-c', command], {
			cwd: execution_directory(temporary_root, is_nested),
			encoding: 'utf8',
			env: { ...git_environment, ...git_overrides },
		})

		return { status, stdout, stderr }
	} finally {
		rmSync(temporary_root, { recursive: true, force: true })
	}
}

const hook_command_bootstrap = { run_in_temporary_checkout }

export { hook_command_bootstrap }
