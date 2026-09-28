import { publish_tag } from './publish-tag'

const ARGUMENT_START = 2
const [version, latest] = process.argv.slice(ARGUMENT_START)

if (!version || !latest) throw new Error('Package version and current latest are required')

console.info(publish_tag(version, latest))
