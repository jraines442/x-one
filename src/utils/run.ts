import { spawn } from 'child_process';
import type { ToolCommand } from './project.js';

/**
 * Run a project-local tool through npx and stream its output to the terminal.
 * Resolves with the child's exit code.
 *
 * shell: true is needed on Windows, where npx is a .cmd file.
 * Termination signals sent to x-one are forwarded to the tool, so the dev
 * server does not keep running after x-one exits.
 */
export function runTool(cwd: string, command: ToolCommand): Promise<number> {
  const args = [command.bin, ...command.args];
  const child = spawn('npx', args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  const forward = (signal: NodeJS.Signals) => () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const onInt = forward('SIGINT');
  const onTerm = forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    };
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolve(signal ? 1 : code ?? 1);
    });
  });
}
