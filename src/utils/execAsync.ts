import { exec, ExecException } from 'child_process';
import { promisify } from 'util';

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecError = ExecException & {
  stdout: string;
  stderr: string;
};

export const execAsync = promisify(exec) as (command: string) => Promise<ExecResult>;
