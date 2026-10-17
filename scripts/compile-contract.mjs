import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import solc from 'solc';

const root = process.cwd();
const source = readFileSync(join(root, 'contracts', 'DocumentRegistry.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: {'DocumentRegistry.sol': {content: source}},
  settings: {
    optimizer: {enabled: true, runs: 200},
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const issue of output.errors || []) {
  if (issue.severity === 'error') throw new Error(issue.formattedMessage);
  console.warn(issue.formattedMessage);
}
const contract = output.contracts?.['DocumentRegistry.sol']?.DocumentRegistry;
if (!contract?.evm?.bytecode?.object) throw new Error('DocumentRegistry did not compile');
const artifact = {abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`, compiler: solc.version()};
writeFileSync(join(root, 'frontend', 'registry-artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Compiled DocumentRegistry with ${solc.version()}`);
