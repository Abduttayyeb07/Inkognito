import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const root = process.cwd();
const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', shell: false});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(python)) {
  console.log('Creating Python virtual environment...');
  run(process.platform === 'win32' ? 'python.exe' : 'python3', ['-m', 'venv', '.venv']);
}
console.log('Installing Python API dependencies...');
run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
console.log('Setup complete. Run npm run dev.');
