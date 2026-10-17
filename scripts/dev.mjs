import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';

const root = process.cwd();
const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(python) || !existsSync(vite)) {
  console.error('Run npm install and npm run setup first.');
  process.exit(1);
}

const api = spawn(python, ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8765', '--reload', '--reload-dir', 'backend'], {cwd: root, stdio: 'inherit'});
const web = spawn(process.execPath, [vite, '--host', '0.0.0.0'], {cwd: root, stdio: 'inherit'});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [api, web]) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
api.on('error', error => {console.error(`Python API failed: ${error.message}`); stop(1);});
web.on('error', error => {console.error(`Vite failed: ${error.message}`); stop(1);});
api.on('exit', code => {if (!stopping) {console.error('Python API stopped.'); stop(code || 1);}});
web.on('exit', code => {if (!stopping) {console.error('Vite stopped.'); stop(code || 1);}});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
