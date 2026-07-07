import type { UpstreamDescriptor } from './version-command-config'

const KIT_PACKAGE_NAME = '@joshuafolkken/kit'

// Kit's own upstream descriptor. Downstream consumers (app-kit, game-kit) declare kit in their
// `upstreams` chain through this constant instead of hardcoding kit's package name or endpoint.
// Kept in its own module so importing it never pulls in kit's doctor-dependent config.
const kit_package_descriptor: UpstreamDescriptor = { package_name: KIT_PACKAGE_NAME }

export { KIT_PACKAGE_NAME, kit_package_descriptor }
