import { github_release } from './github-release'

const token = process.env['GH_TOKEN']
const tag = process.env['RELEASE_TAG']

if (!token || !tag) throw new Error('GH_TOKEN and RELEASE_TAG are required')

console.info(await github_release.publish(fetch, token, tag))
