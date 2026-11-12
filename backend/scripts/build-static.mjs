/**
 * Builds `dist/`, the only folder Vercel publishes.
 *
 * It copies exactly what the Express server allows the public to fetch, so source code,
 * documentation and the admin pages can never be published by accident. Admin pages are
 * served by Render behind the login check, through the proxy rules in vercel.json.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isPublicStaticPath } from '../src/middleware/security.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** On Vercel, a missing setting would leave the proxy pointing at a literal "$BACKEND_URL". */
export function deploymentProblems(env = process.env) {
  if (!env.VERCEL) return [];
  const problems = [];
  if (!/^https:\/\/[^/\s]+$/.test(String(env.BACKEND_URL ?? ''))) {
    problems.push('BACKEND_URL must be your Render address, like https://your-service.onrender.com, with no trailing slash.');
  }
  if (String(env.PROXY_SECRET ?? '').length < 32) {
    problems.push('PROXY_SECRET must be set to at least 32 characters, the same value as on Render.');
  }
  return problems;
}

/** Every file under frontend/ that the server allows the public to fetch. */
async function publicFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => isPublicStaticPath(`/${file}`));
}

export async function buildStatic({ root = path.join(repositoryRoot, 'frontend'), outDir = path.join(repositoryRoot, 'dist') } = {}) {
  await rm(outDir, { recursive: true, force: true });
  const files = await publicFiles(root);
  for (const file of files) {
    const target = path.join(outDir, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }
  return files.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = deploymentProblems();
  if (problems.length > 0) {
    console.error(`[build] Vercel settings need attention:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
  const files = await buildStatic();
  console.log(`[build] Copied ${files.length} public files to dist/`);
}
