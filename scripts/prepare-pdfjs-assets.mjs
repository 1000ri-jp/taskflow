import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PDFJS_VERSION = '6.4.299';
const assets = ['build/pdf.worker.min.mjs', 'cmaps', 'standard_fonts', 'wasm', 'LICENSE'];

function assertStaticAsset(source) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) {
    throw new Error(`PDF.js asset must be a regular file or directory: ${source}`);
  }
  if (stat.isDirectory()) for (const child of readdirSync(source)) assertStaticAsset(path.join(source, child));
}

// Only package-owned static assets are published; the display API stays in the lazy client bundle.
export function preparePdfjsAssets(root = fileURLToPath(new URL('..', import.meta.url))) {
  const source = path.join(root, 'node_modules', 'pdfjs-dist');
  const installed = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (installed.version !== PDFJS_VERSION) {
    throw new Error(`Expected pdfjs-dist ${PDFJS_VERSION}, found ${installed.version}. Update the renderer and asset version together.`);
  }
  for (const asset of assets) assertStaticAsset(path.join(source, asset));

  const destination = path.join(root, 'public', 'pdfjs', PDFJS_VERSION);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const asset of assets) {
    cpSync(path.join(source, asset), path.join(destination, path.basename(asset)), { recursive: true });
  }
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`PDF.js ${PDFJS_VERSION} assets ready: ${preparePdfjsAssets()}`);
}
