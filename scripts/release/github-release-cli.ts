import { execFileSync } from 'node:child_process'
import { github_release } from './github-release'

const token = process.env['GH_TOKEN']
const tag = process.env['RELEASE_TAG']

if (!token || !tag) throw new Error('GH_TOKEN and RELEASE_TAG are required')

const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).trim().split('\n')

console.info(await github_release.publish(fetch, token, tag, { tags }))
