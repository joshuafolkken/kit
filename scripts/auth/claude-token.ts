import { execaSync } from 'execa'

// Where the Claude Code token of `josh fresh:run` lives on the host: the macOS keychain item
// `josh auth:setup` writes, or — on a machine without a keychain — `CLAUDE_CODE_OAUTH_TOKEN` in the
// environment. No shell profile is read or written, so no other Claude Code on the host changes how
// it signs in.

const VARIABLE = 'CLAUDE_CODE_OAUTH_TOKEN'
const SERVICE = 'josh-claude-code-oauth-token'
const ACCOUNT = 'josh'
const SECURITY = 'security'
const SECURITY_TIMEOUT_MS = 10_000
const FIND = 'find-generic-password'
const ITEM_ARGUMENTS: ReadonlyArray<string> = ['-s', SERVICE, '-a', ACCOUNT]
// The modification date of the item, `"mdat"<timedate>=0x… "20261014071518Z\000"`, in UTC.
const SAVED_DATE_PATTERN = /"mdat"<timedate>=\S+\s+"(\d{4})(\d{2})(\d{2})/u

function security(arguments_: ReadonlyArray<string>, input = ''): string | undefined {
	try {
		const { stdout } = execaSync(SECURITY, [...arguments_], { input, timeout: SECURITY_TIMEOUT_MS })

		return stdout
	} catch {
		return undefined
	}
}

function non_empty(value: string | undefined): string | undefined {
	const trimmed = value?.trim()

	return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function from_keychain(): string | undefined {
	return non_empty(security([FIND, ...ITEM_ARGUMENTS, '-w']))
}

// The keychain first, then the environment; `undefined` when neither holds a token.
function read(): string | undefined {
	return from_keychain() ?? non_empty(process.env[VARIABLE])
}

// `security -i` reads its command from stdin, so the token is in no argument list `ps` could show.
// The item is read back, because the interactive mode exits 0 whether or not the command succeeded.
function save(token: string): boolean {
	security(['-i'], `add-generic-password -U ${ITEM_ARGUMENTS.join(' ')} -w "${token}"\n`)

	return from_keychain() === token
}

// The day the item was last written, `YYYY-MM-DD`; `undefined` when there is none.
function saved_date(): string | undefined {
	const attributes = security([FIND, ...ITEM_ARGUMENTS])
	const match = attributes === undefined ? undefined : SAVED_DATE_PATTERN.exec(attributes)

	return match?.slice(1).join('-')
}

// Whether `security` answers at all, asked before a sign-in whose token would have nowhere to go.
function has_keychain(): boolean {
	return security(['list-keychains']) !== undefined
}

const SETUP_HINT = 'Run `pnpm josh auth:setup` to save one.'

const claude_token = { read, save, saved_date, has_keychain, VARIABLE, SETUP_HINT }

export { claude_token }
