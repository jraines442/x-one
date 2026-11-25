// Smoke tests: exercise the built CLI end to end.
// Run after `npm run build` (the `test` script does this automatically).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'x-one-smoke-'));
}

describe('CLI boots', () => {
  test('--version prints the package version', () => {
    const result = runCli(['--version'], process.cwd());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0\.1\.0/);
  });

  test('--help lists the create, dev and build commands', () => {
    const result = runCli(['--help'], process.cwd());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /create/);
    assert.match(result.stdout, /dev/);
    assert.match(result.stdout, /build/);
  });
});

describe('create scaffolds each template', () => {
  const expectedFiles = {
    react: ['vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx'],
    nextjs: ['next.config.js', 'app/layout.tsx', 'app/page.tsx'],
    vite: ['vite.config.ts', 'index.html', 'src/main.ts', 'src/counter.ts'],
  };

  for (const [template, files] of Object.entries(expectedFiles)) {
    test(`template: ${template}`, () => {
      const dir = makeTempDir();
      try {
        const name = `smoke-${template}`;
        const result = runCli(
          ['create', name, '--template', template, '--skip-git'],
          dir,
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);

        const projectDir = join(dir, name);
        const pkgPath = join(projectDir, 'package.json');
        assert.ok(existsSync(pkgPath), 'package.json was not generated');

        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        assert.equal(pkg.name, name);
        assert.ok(pkg.scripts?.dev, 'package.json is missing a dev script');
        assert.ok(pkg.scripts?.build, 'package.json is missing a build script');

        assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
        assert.ok(existsSync(join(projectDir, 'README.md')), 'README.md missing');
        assert.ok(existsSync(join(projectDir, '.gitignore')), '.gitignore missing');

        for (const file of files) {
          assert.ok(existsSync(join(projectDir, file)), `${file} was not generated`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('create error handling', () => {
  test('refuses to overwrite an existing directory', () => {
    const dir = makeTempDir();
    try {
      const first = runCli(['create', 'dupe', '--template', 'vite', '--skip-git'], dir);
      assert.equal(first.status, 0, first.stderr || first.stdout);

      const second = runCli(['create', 'dupe', '--template', 'vite', '--skip-git'], dir);
      assert.notEqual(second.status, 0, 'second create should fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects an unknown template', () => {
    const dir = makeTempDir();
    try {
      const result = runCli(['create', 'bogus', '--template', 'angular', '--skip-git'], dir);
      assert.notEqual(result.status, 0, 'unknown template should fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
