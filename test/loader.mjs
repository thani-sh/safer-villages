// Registered by `npm test` (node --import ./test/loader.mjs --test ...), which
// installs the resolve hook before any test file imports the addon.
import { register } from "node:module";

register(new URL("./resolve-minecraft-server.mjs", import.meta.url));
