import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type DetectedFramework = 'vite' | 'nextjs';

export interface DetectedProject {
  framework: DetectedFramework;
  root: string;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Work out which build tool a project uses from its package.json.
 * Next.js wins over Vite if both are present.
 */
export function detectProject(root: string): DetectedProject {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(
      `No package.json found in ${root}. Run x-one from inside a project folder.`
    );
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageManifest;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if ('next' in deps) {
    return { framework: 'nextjs', root };
  }
  if ('vite' in deps) {
    return { framework: 'vite', root };
  }

  throw new Error(
    'Could not detect a supported framework. Expected "next" or "vite" in package.json dependencies.'
  );
}

export interface ToolCommand {
  /** The executable to run through npx, e.g. "vite" or "next". */
  bin: string;
  args: string[];
}

export interface DevOptions {
  port?: string;
  host?: string;
}

export interface BuildOptions {
  outdir?: string;
}

/** Build the dev-server command for a detected framework. */
export function devCommandFor(
  framework: DetectedFramework,
  options: DevOptions = {}
): ToolCommand {
  if (framework === 'vite') {
    // `vite` with no subcommand starts the dev server.
    const args: string[] = [];
    if (options.port) args.push('--port', options.port);
    if (options.host) args.push('--host', options.host);
    return { bin: 'vite', args };
  }

  // Next.js
  const args = ['dev'];
  if (options.port) args.push('-p', options.port);
  if (options.host) args.push('-H', options.host);
  return { bin: 'next', args };
}

/** Build the production-build command for a detected framework. */
export function buildCommandFor(
  framework: DetectedFramework,
  options: BuildOptions = {}
): ToolCommand {
  if (framework === 'vite') {
    const args = ['build'];
    if (options.outdir) args.push('--outDir', options.outdir);
    return { bin: 'vite', args };
  }

  // Next.js always writes to .next and has no output-directory flag.
  return { bin: 'next', args: ['build'] };
}
