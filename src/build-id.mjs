import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function buildId(root) {
  const hash = createHash("sha256");
  function add(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(directory, entry.name);
      if (entry.isDirectory()) add(name);
      else if (entry.isFile()) { hash.update(name); hash.update(readFileSync(join(root, name))); }
    }
  }
  for (const name of ["src", "scripts", "plugins"]) if (existsSync(join(root, name))) add(name);
  return hash.digest("hex").slice(0, 12);
}
