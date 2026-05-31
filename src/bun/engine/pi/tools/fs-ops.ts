/**
 * Filesystem operations wrapper for Pi engine tools.
 *
 * Re-exports Node.js `node:fs` functions with their original signatures intact.
 * This single import point enables test-time mocking via `vi.mock()` without
 * changing tool signatures or requiring dependency injection.
 */

export {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  renameSync,
  mkdirSync,
  statSync,
  rmSync,
} from "node:fs";
