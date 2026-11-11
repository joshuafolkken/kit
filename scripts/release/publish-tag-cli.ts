import { fileURLToPath } from 'node:url'
import { publish_tag } from './publish-tag'

const ARGUMENT_START = 2

function main(argv: ReadonlyArray<string>): void {
	const [version, latest] = argv.slice(ARGUMENT_START)

	if (!version || !latest) throw new Error('Package version and current latest are required')

	console.info(publish_tag(version, latest))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv)

const publish_tag_cli = { main }

export { publish_tag_cli }
