import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const exec_async = promisify(exec)
const GH_NOT_INSTALLED_MSG = 'gh CLI is not installed. Install it from https://cli.github.com/'

const gh_check: { promise?: Promise<void> } = {}

async function run_gh_check(): Promise<void> {
	try {
		await exec_async('gh --version')
	} catch {
		delete gh_check.promise
		throw new Error(GH_NOT_INSTALLED_MSG)
	}
}

async function check_gh_installed(): Promise<void> {
	gh_check.promise ??= run_gh_check()
	await gh_check.promise
}

export { check_gh_installed, GH_NOT_INSTALLED_MSG }
