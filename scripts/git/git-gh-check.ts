import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const exec_async = promisify(exec)
const GH_NOT_INSTALLED_MSG = 'gh CLI is not installed. Install it from https://cli.github.com/'

async function check_gh_installed(): Promise<void> {
	try {
		await exec_async('gh --version')
	} catch {
		throw new Error(GH_NOT_INSTALLED_MSG)
	}
}

export { check_gh_installed, GH_NOT_INSTALLED_MSG }
