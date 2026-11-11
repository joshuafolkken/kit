import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'

// A local registry inside the container, so a dependency inside the release-age wait is there on every
// run rather than whenever the npm registry happens to have one (joshuafolkken/kit#7218). Verdaccio
// proxies every other package to npm with its real publish times. kit is served only from the packed
// checkout, dated older than the wait as a release a person installs is; kit's direct dependency
// `run-parallel` gains a next patch version, inside kit's range for it, dated inside `josh init`'s
// three-day wait yet past the one day pnpm waits by default — the window #7200 was found in.

const PORT = 4873
const URL = `http://localhost:${String(PORT)}/`
const HOST = `//localhost:${String(PORT)}/`
const VERDACCIO = 'verdaccio@6'
const DIRECTORY = '"$HOME/registry"'
const FRESH_DEPENDENCY = 'run-parallel'
const FRESH_AGE_DAYS = 2
const KIT_AGE_DAYS = 10
const READY_ATTEMPTS = 60
// Anyone reads and publishes: the registry lives only as long as the container.
const OPEN = ['    access: $all', '    publish: $all']

const CONFIG = [
	'storage: ./storage',
	'uplinks:',
	'  npmjs:',
	'    url: https://registry.npmjs.org/',
	'packages:',
	// Double-quoted, since the whole file is one single-quoted shell word.
	`  "${KIT_PACKAGE_NAME}":`,
	...OPEN,
	'  "**":',
	...OPEN,
	'    proxy: npmjs',
	'log: { type: stdout, format: pretty, level: warn }',
].join('\n')

const WRITE_CONFIG = String.raw`mkdir -p ${DIRECTORY} && printf '%s\n' '${CONFIG}' > ${DIRECTORY}/config.yaml`
// Fetched in the foreground first, so the wait below is the server starting rather than its download;
// both run before the registry is pointed at, so verdaccio itself comes from npm. Its output goes to a
// file the probes print.
const FETCH = `pnpm dlx ${VERDACCIO} --version`
const START = `(pnpm dlx ${VERDACCIO} --config ${DIRECTORY}/config.yaml --listen ${String(PORT)} > ${DIRECTORY}/verdaccio.log 2>&1 &)`
// A registry that never answers ends the run before the probes, so its log is printed here.
const WAIT = `for attempt in $(seq ${String(READY_ATTEMPTS)}); do curl -fs ${URL}-/ping > /dev/null && break; sleep 1; done; curl -fs ${URL}-/ping || { cat ${DIRECTORY}/verdaccio.log; false; }`
// Every later install, `pnpm dlx` included, reads the local registry; the token is any value, since
// the registry lets anyone publish.
const USE = `pnpm config set registry ${URL} --location global && pnpm config set '${HOST}:_authToken' fresh-machine --location global`
const PUBLISH_KIT = 'pnpm publish "$PACKAGE_TARBALL" --no-git-checks'
// The latest published `run-parallel`, unpacked, given the next patch version and published again —
// in a subshell, so the project stays the directory the next command runs in.
const BUMP_SCRIPT = `const fs = require('node:fs'); const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')); const [major, minor, patch] = manifest.version.split('.').map(Number); manifest.version = [major, minor, patch + 1].join('.'); fs.writeFileSync('package.json', JSON.stringify(manifest, null, 2)); console.log(manifest.version)`
const PUBLISH_FRESH = `(${[
	`mkdir -p ${DIRECTORY}/fresh && cd ${DIRECTORY}/fresh`,
	`curl -fsSL "$(curl -fs ${URL}${FRESH_DEPENDENCY}/latest | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).dist.tarball')" | tar -xz`,
	`cd package && node -e "${BUMP_SCRIPT}"`,
	'pnpm publish --no-git-checks',
].join(' && ')})`
// A publish is dated now; verdaccio serves the time its storage holds, so the version just published
// is given the age it stands in for there.
const BACKDATE_SCRIPT = `const fs = require('node:fs'); const [file, days] = process.argv.slice(1); const metadata = JSON.parse(fs.readFileSync(file, 'utf8')); const version = metadata['dist-tags'].latest; metadata.time[version] = new Date(Date.now() - Number(days) * 86400000).toISOString(); fs.writeFileSync(file, JSON.stringify(metadata)); console.log(version, metadata.time[version])`

function backdate(name: string, days: number): string {
	return `node -e "${BACKDATE_SCRIPT}" ${DIRECTORY}/storage/${name}/package.json ${String(days)}`
}

const COMMANDS = [
	WRITE_CONFIG,
	FETCH,
	START,
	WAIT,
	USE,
	PUBLISH_KIT,
	backdate(KIT_PACKAGE_NAME, KIT_AGE_DAYS),
	PUBLISH_FRESH,
	backdate(FRESH_DEPENDENCY, FRESH_AGE_DAYS),
]
// What the registry served: the dependency's publish times, and verdaccio's log.
const PROBES = [
	`curl -fs ${URL}${FRESH_DEPENDENCY} | node -p 'JSON.stringify(JSON.parse(require("node:fs").readFileSync(0, "utf8")).time)'`,
	`cat ${DIRECTORY}/verdaccio.log`,
]

const fresh_machine_registry = { COMMANDS, PROBES, FRESH_DEPENDENCY }

export { fresh_machine_registry }
