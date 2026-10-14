#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { claude_token } from './claude-token'
import { claude_token_output } from './claude-token-output'

// `josh auth:setup` — run `claude setup-token` and keep the token it prints in the macOS keychain,
// where `josh fresh:run` reads it. The token reaches neither the screen nor a file: it is replaced in
// the command's output. `--check` answers whether one is saved.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const CLAUDE = 'claude'
const SAVED = `saved: ${claude_token.VARIABLE} (macOS keychain)`
const NO_TOKEN = 'claude setup-token printed no token, so nothing was saved.'
const NO_KEYCHAIN = `This machine has no macOS keychain, so nothing was run. Run \`claude setup-token\` yourself and export ${claude_token.VARIABLE} — josh fresh:run reads it when the keychain has none.`
const NOT_SAVED = 'The keychain did not keep the token. Run `pnpm josh auth:setup` again.'

interface Printed {
	decoder: TextDecoder
	text: string
	shown: number
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

function check(): number {
	const date = claude_token.saved_date()

	if (date === undefined) {
		return refuse(`missing: no ${claude_token.VARIABLE} saved. ${claude_token.SETUP_HINT}`)
	}

	console.info(`ok: ${claude_token.VARIABLE} saved on ${date} (macOS keychain)`)

	return 0
}

function store(token: string | undefined): number {
	if (token === undefined) return refuse(NO_TOKEN)

	if (!claude_token.save(token)) return refuse(NOT_SAVED)

	console.info(SAVED)

	return 0
}

// The sign-in URL and any prompt are shown as they arrive; from the token on, the output is held
// back and shown once claude ends, with the token replaced.
function show_live(printed: Printed, chunk: Uint8Array): void {
	printed.text += printed.decoder.decode(chunk, { stream: true })
	const live = claude_token_output.live_length(printed.text)

	process.stdout.write(printed.text.slice(printed.shown, live))
	printed.shown = live
}

// The browser sign-in needs the terminal's stdin, so only stdout passes through josh.
async function setup(): Promise<number> {
	if (!claude_token.has_keychain()) return refuse(NO_KEYCHAIN)

	const printed: Printed = { decoder: new TextDecoder(), text: '', shown: 0 }
	const child = execa(CLAUDE, ['setup-token'], {
		stdin: 'inherit',
		stderr: 'inherit',
		reject: false,
	})

	child.stdout.on('data', (chunk: Uint8Array) => {
		show_live(printed, chunk)
	})
	const result = await child
	const held = printed.text.slice(printed.shown) + printed.decoder.decode()
	const { token, shown } = claude_token_output.capture(held)

	process.stdout.write(shown)

	if (result.failed) return refuse(`claude setup-token failed: ${result.shortMessage ?? CLAUDE}`)

	return store(token)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const { values } = parseArgs({ args: [...argv], options: { check: { type: 'boolean' } } })

	return values.check === true ? check() : await setup()
}

const auth_setup_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { auth_setup_cli }
