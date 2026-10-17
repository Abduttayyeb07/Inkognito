import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {join} from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {ContractFactory, JsonRpcProvider, ZeroAddress, ZeroHash, solidityPackedKeccak256} from 'ethers';

const root = process.cwd();
const ZeroBytes8 = '0x0000000000000000';
const artifact = JSON.parse(readFileSync(join(root, 'frontend', 'registry-artifact.json'), 'utf8'));

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForNode(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error('Local EVM stopped before startup');
    try {
      const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});
      if ((await response.json()).result) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local EVM did not start');
}

test('commit-reveal records an exact file hash, registrar, page count and commit time on a local EVM', async () => {
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,
    [join(root, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js'), 'node', '--hostname', '127.0.0.1', '--port', String(port)],
    {cwd:root, stdio:['ignore', 'ignore', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => {stderr += chunk.toString().slice(0, 1000);});
  try {
    await waitForNode(url, child);
    const provider = new JsonRpcProvider(url);
    const signer = await provider.getSigner(0);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    assert.equal((await provider.getCode(await contract.getAddress())).toLowerCase(), artifact.deployedBytecode.toLowerCase());
    const other = await provider.getSigner(1);
    const fileHash = `0x${'11'.repeat(32)}`;
    const salt = `0x${'aa'.repeat(32)}`;
    const pageHashes = ['0123456789abcdef', 'fedcba9876543210'];
    const phashRoot = `0x${createHash('sha256').update(pageHashes.join('')).digest('hex')}`;
    const hashBytes = `0x${pageHashes.join('')}`;
    const wid = '0x123456789abcdef1';
    const commitmentFor = (hash, id, account, value) => solidityPackedKeccak256(['bytes32', 'bytes8', 'address', 'bytes32'], [hash, id, account, value]);
    const commitment = commitmentFor(fileHash, wid, await signer.getAddress(), salt);

    // Reveal without a commitment is rejected.
    await assert.rejects(contract.register.staticCall(fileHash, salt, phashRoot, 2, hashBytes, wid), /NoCommitment/);
    // Commit, and a duplicate commitment is rejected.
    const commitReceipt = await (await contract.commit(commitment)).wait();
    assert.equal(commitReceipt.status, 1);
    await assert.rejects(contract.commit.staticCall(commitment), /AlreadyCommitted/);
    await assert.rejects(contract.commit.staticCall(ZeroHash), /InvalidFingerprint/);
    // Another wallet cannot reveal this commitment, even with the same hash and salt.
    await assert.rejects(contract.connect(other).register.staticCall(fileHash, salt, phashRoot, 2, hashBytes, wid), /NoCommitment/);
    // Wrong page hashes, wrong page count and out-of-range values are rejected.
    await assert.rejects(contract.register.staticCall(fileHash, salt, phashRoot, 2, `0x${'00'.repeat(16)}`, wid), /InvalidFingerprint/);
    await assert.rejects(contract.register.staticCall(fileHash, salt, phashRoot, 1, hashBytes, wid), /InvalidFingerprint/);
    await assert.rejects(contract.register.staticCall(ZeroHash, salt, phashRoot, 2, hashBytes, wid), /InvalidFingerprint/);

    const receipt = await (await contract.register(fileHash, salt, phashRoot, 2, hashBytes, wid)).wait();
    assert.equal(receipt.status, 1);
    const record = await contract.records(fileHash);
    assert.equal(record.registrar.toLowerCase(), (await signer.getAddress()).toLowerCase());
    assert.equal(record.pageCount, 2n);
    assert.equal(record.phashRoot, phashRoot);
    assert.equal(Number(record.registeredAt), (await provider.getBlock(commitReceipt.blockNumber)).timestamp);
    assert.equal((await contract.commitments(commitment)).committer, ZeroAddress);
    assert.equal((await contract.records(`0x${'33'.repeat(32)}`)).registrar, ZeroAddress);

    // The event carries the per-page pHashes for off-chain similarity search.
    const events = await contract.queryFilter(contract.filters.DocumentRegistered(fileHash));
    assert.equal(events.length, 1);
    assert.equal(events[0].args.pageHashes, hashBytes);

    // The hidden watermark ID maps to the record and is in the event.
    assert.equal(await contract.watermarks(wid), fileHash);
    assert.equal(events[0].args.watermarkId, wid);
    // A different file cannot claim the same watermark ID.
    const salt3 = `0x${'cc'.repeat(32)}`;
    const otherFile = `0x${'55'.repeat(32)}`;
    await (await contract.connect(other).commit(commitmentFor(otherFile, wid, await other.getAddress(), salt3))).wait();
    await assert.rejects(contract.connect(other).register.staticCall(otherFile, salt3, phashRoot, 2, hashBytes, wid), /WatermarkTaken/);
    // Revealing with a different watermark ID than committed is rejected.
    const thirdFile = `0x${'66'.repeat(32)}`;
    await (await contract.commit(commitmentFor(thirdFile, ZeroBytes8, await signer.getAddress(), salt))).wait();
    await assert.rejects(contract.register.staticCall(thirdFile, salt, phashRoot, 2, hashBytes, '0x00000000000000aa'), /NoCommitment/);
    // A file without a hidden watermark registers with a zero ID and claims no mapping.
    await (await contract.register(thirdFile, salt, phashRoot, 2, hashBytes, ZeroBytes8)).wait();
    assert.equal((await contract.records(thirdFile)).pageCount, 2n);
    assert.equal(await contract.watermarks(ZeroBytes8), ZeroHash);

    // A second registration of the same file is rejected, even through a fresh commitment.
    const salt2 = `0x${'bb'.repeat(32)}`;
    await (await contract.connect(other).commit(commitmentFor(fileHash, wid, await other.getAddress(), salt2))).wait();
    await assert.rejects(contract.connect(other).register.staticCall(fileHash, salt2, phashRoot, 2, hashBytes, wid), /AlreadyRegistered/);
  } catch (error) {
    error.message += `\nLocal EVM stderr: ${stderr}`;
    throw error;
  } finally {
    child.kill('SIGTERM');
  }
});
