import { execaSync } from 'execa'

const GH_CLI_TIMEOUT_MS = 5000

function get(): string | undefined {
	try {
		const { stdout } = execaSync('gh', ['auth', 'token'], { timeout: GH_CLI_TIMEOUT_MS })
		const token = stdout.trim()

		return token.length > 0 ? token : undefined
	} catch {
		return undefined
	}
}

const gh_cli_token = { get }

export { gh_cli_token }
