import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { migrate } from './migrate'

const USAGE = 'Usage: node registry-migrate.mjs <exact-kit-version> [--dry-run]'
const ARGUMENT_OFFSET = 2

function parse(args: ReadonlyArray<string>): { version: string; is_dry_run: boolean } {
	const [version, ...flags] = args
	if (version === undefined || flags.some((flag) => flag !== '--dry-run')) throw new Error(USAGE)

	return { version, is_dry_run: flags.includes('--dry-run') }
}

async function main(args: ReadonlyArray<string>): Promise<void> {
	const { version, is_dry_run } = parse(args)
	const changes = await migrate(process.cwd(), version, is_dry_run)

	console.info(`${is_dry_run ? 'Planned' : 'Changed'}: ${changes.join(', ') || 'none'}`)
	console.info(
		'Next: install the target kit from npm, then run its josh sync. User npmrc and node_modules were not changed.',
	)
}

async function run(
	args: ReadonlyArray<string> = process.argv.slice(ARGUMENT_OFFSET),
): Promise<void> {
	try {
		if (args.includes('--help')) {
			console.info(USAGE)

			return
		}

		await main(args)
	} catch (error) {
		console.error(error_text.message_of(error))
		process.exit(1)
	}
}

if (
	process.argv[1] !== undefined &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await run()
}

export { main, run }
