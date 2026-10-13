// The "fresh machine" of `josh fresh:run`: a Debian image with curl and without Node.js, pnpm, git or
// gh, on which a normal user runs the Linux route of `docs/setup/prerequisites.md` and nothing else.
// The Dockerfile is built here rather than kept as a file because `docs/` is not in the published
// package and a consumer toolkit builds the same machine; `fresh-machine-image.test.ts` holds the
// commands below to the guide's own lines.

const BASE_IMAGE = 'buildpack-deps:bookworm-curl'
const MACHINE_USER = 'dev'
const HOME_DIRECTORY = `/home/${MACHINE_USER}`
const TAG_PREFIX = 'josh-fresh-machine'

// `docs/setup/prerequisites.md` → "Linux and macOS". The first line runs in the shell a new machine
// starts with; the guide then says to open a new terminal, which is what `NEW_TERMINAL` does.
const INSTALL_PNPM = 'curl -fsSL https://get.pnpm.io/install.sh | sh -'
const NEW_TERMINAL_COMMANDS = ['pnpm runtime set node 22 -g', 'node --version']

// The guide sends a Linux reader to the gh installation page; these are that page's Debian steps,
// run as root in place of `sudo`, with the curl the image already has. git comes from the same
// package manager. Only a GitHub scenario's machine has either.
const KEYRING = '/etc/apt/keyrings/githubcli-archive-keyring.gpg'
const APT_UPDATE = 'apt-get update'
const GITHUB_TOOLS = [
	APT_UPDATE,
	'apt-get install -y git',
	'mkdir -p -m 755 /etc/apt/keyrings',
	`curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o ${KEYRING}`,
	`chmod go+r ${KEYRING}`,
	`echo "deb [arch=$(dpkg --print-architecture) signed-by=${KEYRING}] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list`,
	APT_UPDATE,
	'apt-get install -y gh',
].join(' && ')

function new_terminal(command: string): string {
	return `RUN bash -ic '${command}'`
}

// `SHELL` is the one line the guide does not have: the pnpm installer reads it to pick the profile
// it edits, and a container build does not set it.
function dockerfile(requires_github: boolean): string {
	const github_tools = requires_github ? [`RUN ${GITHUB_TOOLS}`] : []

	return [
		`FROM ${BASE_IMAGE}`,
		...github_tools,
		`RUN useradd --create-home --shell /bin/bash ${MACHINE_USER}`,
		`USER ${MACHINE_USER}`,
		`WORKDIR ${HOME_DIRECTORY}`,
		'ENV SHELL=/bin/bash',
		`RUN ${INSTALL_PNPM}`,
		...NEW_TERMINAL_COMMANDS.map((command) => new_terminal(command)),
		'',
	].join('\n')
}

function tag(requires_github: boolean): string {
	return `${TAG_PREFIX}:${requires_github ? 'github' : 'base'}`
}

const fresh_machine_image = { dockerfile, tag }

export { fresh_machine_image }
