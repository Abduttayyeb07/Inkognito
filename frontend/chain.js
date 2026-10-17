import {BrowserProvider, Contract, ContractFactory, JsonRpcProvider, ZeroAddress, ZeroHash, hexlify, isAddress, randomBytes, solidityPackedKeccak256, verifyMessage} from 'ethers';
import artifact from './registry-artifact.json';

const CHAIN_ID = 11155111n;
const CHAIN_HEX = '0xaa36a7';
const EXPLORER = 'https://sepolia.etherscan.io';
const RPC_URL = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const STORAGE_KEY = 'documark:sepolia-registry';
const TX_KEY = 'documark:sepolia-tx';
const savedTx = hash => { try { return JSON.parse(localStorage.getItem(TX_KEY) || '{}')[hash] || null; } catch { return null; } };
const saveTx = (hash, tx) => { try { const all = JSON.parse(localStorage.getItem(TX_KEY) || '{}'); all[hash] = tx; localStorage.setItem(TX_KEY, JSON.stringify(all)); } catch {} };
const COMMIT_KEY = 'documark:sepolia-commit';
const loadCommit = key => { try { return JSON.parse(localStorage.getItem(COMMIT_KEY) || '{}')[key] || null; } catch { return null; } };
const saveCommit = (key, value) => { try { const all = JSON.parse(localStorage.getItem(COMMIT_KEY) || '{}'); all[key] = value; localStorage.setItem(COMMIT_KEY, JSON.stringify(all)); } catch {} };
const PAGE_MATCH_BITS = 10;   // max differing bits (of 64) for two pages to count as visually the same
const DOC_MATCH_RATIO = 0.6;  // share of pages that must match for a document to be flagged
const NO_MARK = '0x0000000000000000';
const commitmentOf = (fileHash, wid, account, salt) => solidityPackedKeccak256(['bytes32', 'bytes8', 'address', 'bytes32'], [fileHash, wid, account, salt]);
let analysis = null;

const $ = selector => document.querySelector(selector);
const short = address => `${address.slice(0, 8)}…${address.slice(-6)}`;

function chainStatus(message, error = false) {
  const node = $('#chain-status');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', error);
}

function failure(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'Wallet request cancelled.';
  const message = error?.shortMessage || error?.reason || error?.message || String(error);
  if (/insufficient funds|funds for gas/i.test(message)) return 'This wallet needs Sepolia test ETH to deploy the registry.';
  if (/user rejected|denied transaction/i.test(message)) return 'Wallet request cancelled.';
  const reasons = {
    RevealTooSoon: 'Sepolia has not moved past the commit block yet. Click Register exact hash again in a few seconds; it resumes at the reveal.',
    NoCommitment: 'The commit is not visible yet (or was made from another wallet). Click Register exact hash again in a few seconds; it resumes at the reveal.',
    AlreadyRegistered: 'This exact file hash is already registered.',
    WatermarkTaken: 'This hidden watermark ID is already linked to another registered file.',
    AlreadyCommitted: 'This commitment already exists. Click Register exact hash again to continue with the reveal.',
    InvalidFingerprint: 'The fingerprint is invalid (page hashes, page count or pHash root). Analyze the file again.'
  };
  if (reasons[error?.revert?.name]) return reasons[error.revert.name];
  return message.slice(0, 220);
}

function address() {
  const value = $('#registry-address')?.value.trim();
  if (!isAddress(value)) throw new Error('Enter a valid Sepolia registry contract address.');
  return value;
}

async function wallet() {
  if (!window.ethereum) throw new Error('Install an Ethereum browser wallet such as MetaMask to send Sepolia transactions.');
  let provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) {
    await provider.send('wallet_switchEthereumChain', [{chainId: CHAIN_HEX}]);
    provider = new BrowserProvider(window.ethereum);
  }
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) throw new Error('Select Ethereum Sepolia in your wallet.');
  return {provider, signer: await provider.getSigner()};
}

async function reader() {
  if (window.ethereum) {
    try {
      const browser = new BrowserProvider(window.ethereum);
      if ((await browser.getNetwork()).chainId === CHAIN_ID) return browser;
    } catch {}
  }
  const provider = new JsonRpcProvider(RPC_URL);
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) throw new Error('The read-only RPC is not on Sepolia. Check VITE_SEPOLIA_RPC_URL.');
  return provider;
}

async function checkedContract(provider, target = address()) {
  const code = await provider.getCode(target);
  if (code === '0x') throw new Error('No contract is deployed at this Sepolia address.');
  if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
    throw new Error('This address is not the current DocuMark registry (it may be an older version). Click Deploy test registry to deploy the new one.');
  return new Contract(target, artifact.abi, provider);
}

function resultRow(label, value) {
  const row = document.createElement('div'); row.className = 'fingerprint-row';
  const title = document.createElement('strong'); title.textContent = label;
  const detail = document.createElement('code'); detail.textContent = String(value);
  row.append(title, detail); return row;
}

function action(label, handler) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'scan-action'; button.textContent = label;
  button.addEventListener('click', handler); return button;
}

function link(label, path) {
  const node = document.createElement('a'); node.href = `${EXPLORER}${path}`;
  node.target = '_blank'; node.rel = 'noopener noreferrer'; node.textContent = label;
  return node;
}

function showRecord(record, txHash = null, fileHash = null, duplicate = false) {
  txHash = txHash || (fileHash && savedTx(fileHash));
  const box = $('#registry-verdict'); if (!box) return;
  box.replaceChildren();
  const heading = document.createElement('h3');
  if (record.registrar === ZeroAddress) {
    heading.textContent = 'No exact hash record found'; box.append(heading);
    const note = document.createElement('p'); note.textContent = 'A re-saved or edited file has a different SHA-256 hash. This result does not rule out a visually similar registered document.'; box.append(note);
    return;
  }
  heading.textContent = duplicate ? 'Already registered — nothing was sent' : 'Exact hash registered on Sepolia'; box.append(heading);
  if (duplicate) { const note = document.createElement('p'); note.textContent = 'This exact file was already registered, so no transaction was made and no gas was spent. The first record is permanent.'; box.append(note); }
  const time = new Date(Number(record.registeredAt) * 1000).toLocaleString();
  box.append(resultRow('Submitted by', record.registrar), resultRow('Registered', time),
             resultRow('Pages', record.pageCount.toString()), resultRow('pHash root', record.phashRoot));
  const links = document.createElement('p'); links.className = 'chain-links';
  links.append(link('View wallet ↗', `/address/${record.registrar}`));
  if (txHash) links.append(link('View transaction ↗', `/tx/${txHash}`));
  box.append(links);
}

const STEPS = ['Connect wallet', '1. Commit (hidden)', '2. Reveal & register', 'Confirmed on-chain'];

function showProgress(active, {commitHash = null, hash = null, receipt = null, failed = false, registry = null} = {}) {
  const box = $('#registry-verdict'); if (!box) return;
  box.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = failed ? 'Transaction failed' : active >= 4 ? 'Registered on Sepolia' : 'Registering on Sepolia…';
  const list = document.createElement('ol'); list.className = 'tx-steps';
  STEPS.forEach((label, index) => {
    const item = document.createElement('li'); item.textContent = label;
    item.className = failed && index === active ? 'failed' : index < active ? 'done' : index === active ? 'current' : '';
    list.append(item);
  });
  const how = document.createElement('p');
  how.textContent = 'Two wallet confirmations protect you from front-running: first only a salted commitment goes on-chain (nobody can see your file hash), then the reveal registers it. The record keeps the earlier commit time.';
  box.append(heading, list, how);
  const links = document.createElement('p'); links.className = 'chain-links';
  if (commitHash) {box.append(resultRow('Commit transaction', commitHash)); links.append(link('View commit ↗', `/tx/${commitHash}`));}
  if (hash) {box.append(resultRow('Register transaction', hash)); links.append(link('View register transaction ↗', `/tx/${hash}`));}
  if (registry && (commitHash || hash)) links.append(link('View registry contract ↗', `/address/${registry}`));
  if (links.childElementCount) box.append(links);
  if (receipt) {
    box.append(resultRow('Status', 'Success'), resultRow('Block', receipt.blockNumber.toString()),
               resultRow('Gas used', receipt.gasUsed.toString()));
  }
}

const popcount = value => { let n = 0; for (let v = value; v; v >>= 1n) n += Number(v & 1n); return n; };
const splitPages = hex => hex.replace(/^0x/, '').match(/.{16}/g) || [];

async function loadEvents(contract) {
  const filter = contract.filters.DocumentRegistered();
  try { return await contract.queryFilter(filter, 0); }
  catch {
    const latest = await contract.runner.provider.getBlockNumber();
    return contract.queryFilter(filter, Math.max(0, latest - 50000));
  }
}

function similarTo(events, mine, fileHash) {
  const out = [];
  for (const event of events) {
    if (event.args.sha256.toLowerCase() === fileHash.toLowerCase()) continue;
    const theirs = splitPages(event.args.pageHashes);
    let matched = 0, bits = 0;
    for (const page of mine) {
      const best = Math.min(...theirs.map(other => popcount(BigInt(`0x${page}`) ^ BigInt(`0x${other}`))));
      if (best <= PAGE_MATCH_BITS) {matched++; bits += best;}
    }
    const total = Math.max(mine.length, theirs.length);
    if (matched / total >= DOC_MATCH_RATIO) out.push({event, matched, total, avg: matched ? bits / matched : 0});
  }
  return out;
}

function showSimilar(matches, scanned) {
  const box = $('#registry-verdict'); if (!box) return;
  const section = document.createElement('div'); section.className = 'similar-box';
  const heading = document.createElement('h3');
  heading.textContent = matches.length ? `Visually similar to ${matches.length} registered document${matches.length > 1 ? 's' : ''}` : 'No visually similar registered documents found';
  section.append(heading);
  if (!scanned) {
    const note = document.createElement('p'); note.textContent = 'Could not scan registry history; try again later.'; section.append(note);
  }
  for (const {event, matched, total, avg} of matches) {
    const row = document.createElement('p');
    row.textContent = `${matched} of ${total} pages look the same (avg ${avg.toFixed(1)}/64 bits different) — registered by ${short(event.args.registrar)}. `;
    row.append(link('View transaction ↗', `/tx/${event.transactionHash}`));
    section.append(row);
  }
  if (matches.length) {
    const note = document.createElement('p');
    note.textContent = 'A resaved, cropped or re-exported copy gets a new SHA-256 but stays visually similar. Compare registration times: the earlier record is the stronger evidence.';
    section.append(note);
  }
  box.append(section);
}

async function connectWallet() {
  try {
    chainStatus('Connecting to Sepolia wallet…');
    const {signer} = await wallet();
    chainStatus(`Connected ${short(await signer.getAddress())} on Sepolia.`);
  } catch (error) {chainStatus(failure(error), true);}
}

async function deployRegistry() {
  let deployed = null;
  try {
    chainStatus('Confirm registry deployment in your Sepolia wallet…');
    const {signer} = await wallet();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const contract = await factory.deploy();
    deployed = await contract.getAddress();
    // Show the deterministic address immediately, while the transaction is pending.
    $('#registry-address').value = deployed;
    localStorage.setItem(STORAGE_KEY, deployed);
    chainStatus(`Deployment submitted for ${short(deployed)}. Waiting for Sepolia confirmation…`);
    await contract.waitForDeployment();
    chainStatus(`Registry deployed at ${short(deployed)}. Share this address to check records elsewhere.`);
  } catch (error) {
    if (deployed) $('#registry-address').value = '';
    chainStatus(failure(error), true);
  }
}

async function checkRecord() {
  if (!analysis) return;
  try {
    address();
    chainStatus('Reading Sepolia registry…');
    const contract = await checkedContract(await reader());
    const fileHash = `0x${analysis.sha256}`;
    const record = await contract.records(fileHash);
    let events = [], scanned = true;
    try { events = await loadEvents(contract); } catch { scanned = false; }
    const own = events.find(event => event.args.sha256.toLowerCase() === fileHash.toLowerCase());
    showRecord(record, own?.transactionHash || null, fileHash);
    if (own && own.args.watermarkId !== NO_MARK) $('#registry-verdict').append(resultRow('Hidden watermark ID', own.args.watermarkId));
    showSimilar(similarTo(events, analysis.phashes, fileHash), scanned);
    chainStatus('Registry lookup complete.');
  } catch (error) {chainStatus(failure(error), true);}
}

async function registerRecord() {
  if (!analysis) return;
  let stage = 0; const ctx = {};
  try {
    const registry = address(); ctx.registry = registry;
    showProgress(0, ctx); chainStatus('Connect your Sepolia wallet to register this exact file hash…');
    const {signer} = await wallet();
    const contract = await checkedContract(signer.provider);
    const account = await signer.getAddress();
    const fileHash = `0x${analysis.sha256}`;
    const existing = await contract.records(fileHash);
    let events = []; try { events = await loadEvents(contract); } catch {}
    if (existing.registrar !== ZeroAddress) {
      const own = events.find(event => event.args.sha256.toLowerCase() === fileHash.toLowerCase());
      showRecord(existing, own?.transactionHash || null, fileHash, true);
      chainStatus('This exact file hash is already registered.');
      return;
    }
    const wid = analysis.watermark_id || NO_MARK;
    if (wid !== NO_MARK && (await contract.watermarks(wid)) !== ZeroHash)
      throw new Error(`The hidden ID ${wid} is already linked to another registered file. Use Find owner to see that record.`);
    const similar = similarTo(events, analysis.phashes, fileHash).filter(match => match.event.args.registrar.toLowerCase() !== account.toLowerCase());
    if (similar.length && !window.confirm(`This document looks visually similar to ${similar.length} document(s) already registered by other wallet(s). Registering still records your own exact file hash. Continue?`)) {
      showProgress(0, ctx); showSimilar(similar, true);
      chainStatus('Registration cancelled.');
      return;
    }
    const writer = contract.connect(signer);
    const key = `${registry.toLowerCase()}:${fileHash}:${wid}:${account.toLowerCase()}`;
    let salt = loadCommit(key)?.salt;
    let commitment = salt && commitmentOf(fileHash, wid, account, salt);
    if (commitment && (await contract.commitments(commitment)).committer.toLowerCase() !== account.toLowerCase()) salt = null;
    if (!salt) {
      salt = hexlify(randomBytes(32));
      commitment = commitmentOf(fileHash, wid, account, salt);
      saveCommit(key, {salt});
      stage = 1; showProgress(1, ctx); chainStatus('Step 1 of 2: confirm the commit in your wallet. Only a hidden commitment goes on-chain.');
      const commitTx = await writer.commit(commitment);
      ctx.commitHash = commitTx.hash; showProgress(1, ctx);
      chainStatus('Commit sent. Waiting for Sepolia to confirm it…');
      try {
        await commitTx.wait();
      } catch (waitError) {
        // A public RPC can time out after broadcasting. Check the commitment before
        // reporting failure; if it is present, the reveal can safely continue.
        const saved = await contract.commitments(commitment);
        if (saved.committer.toLowerCase() !== account.toLowerCase()) throw waitError;
        chainStatus('Commit is confirmed on Sepolia. Continuing to the reveal…');
      }
    } else {
      chainStatus('Found your earlier commit for this file. Continuing to the reveal…');
    }
    stage = 2; showProgress(2, ctx);
    const pageHashes = `0x${analysis.phashes.join('')}`;
    const revealArgs = [fileHash, salt, `0x${analysis.phash_root}`, analysis.pages, pageHashes, wid];
    // The reveal must land in a later block than the commit, and the wallet's node can lag a block
    // behind. Dry-run the reveal until the node agrees, so the wallet never sees a doomed transaction.
    for (let attempt = 0; ; attempt++) {
      try { await writer.register.staticCall(...revealArgs); break; }
      catch (error) {
        const reason = error?.revert?.name;
        if (!['RevealTooSoon', 'NoCommitment'].includes(reason) || attempt >= 30) throw error;
        chainStatus('Commit confirmed. Waiting for the next Sepolia block before the reveal…');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    chainStatus('Step 2 of 2: confirm the reveal in your wallet. This registers the file hash.');
    const transaction = await writer.register(...revealArgs);
    ctx.hash = transaction.hash; showProgress(2, ctx);
    chainStatus('Reveal sent. Waiting for Sepolia to include it in a block (about 15 seconds)…');
    stage = 3; showProgress(3, ctx);
    const receipt = await transaction.wait();
    if (receipt.status !== 1) throw new Error('The transaction reverted on Sepolia (no record was written).');
    saveTx(fileHash, transaction.hash);
    showProgress(4, {...ctx, receipt});
    const record = await contract.records(fileHash);
    const explain = document.createElement('p');
    explain.textContent = `Recorded on-chain: this file's SHA-256, ${wid !== NO_MARK ? `its hidden watermark ID ${wid}, ` : ''}its pHash root and per-page pHashes, ${record.pageCount} page(s), your wallet address and the commit time (${new Date(Number(record.registeredAt) * 1000).toLocaleString()}). The file itself and any personal details were not uploaded.`;
    $('#registry-verdict').append(explain);
    chainStatus('Exact file hash registered on Sepolia.');
  } catch (error) {
    if (stage > 0 || ctx.commitHash) showProgress(stage, {...ctx, failed: true});
    chainStatus(failure(error), true);
  }
}

const CERT_VERSION = 2;

function claimMessage({registry, sha256, watermarkId, registrar, creator, issuedAt}) {
  return ['DocuMark authorship claim', `Registry: ${registry} (Ethereum Sepolia, chain ${CHAIN_ID})`,
          `File SHA-256: ${sha256}`, `Hidden watermark ID: ${watermarkId || '(none)'}`, `Wallet: ${registrar}`, `Creator: ${creator || '(not given)'}`, `Issued: ${issuedAt}`].join('\n');
}

async function downloadCertificate() {
  if (!analysis) return;
  try {
    const registry = address();
    chainStatus('Reading your record…');
    const {signer} = await wallet();
    const contract = await checkedContract(signer.provider);
    const fileHash = `0x${analysis.sha256}`;
    const record = await contract.records(fileHash);
    if (record.registrar === ZeroAddress) throw new Error('This file is not registered yet. Register it first, then create the certificate.');
    const account = await signer.getAddress();
    if (record.registrar.toLowerCase() !== account.toLowerCase())
      throw new Error(`Only the registering wallet (${short(record.registrar)}) can sign the certificate. Switch wallet account in MetaMask.`);
    let events = []; try { events = await loadEvents(contract); } catch {}
    const own = events.find(event => event.args.sha256.toLowerCase() === fileHash.toLowerCase());
    const creator = ($('#creator-name')?.value || '').trim().slice(0, 80);
    const watermarkId = own && own.args.watermarkId !== NO_MARK ? own.args.watermarkId : null;
    const fields = {registry: await contract.getAddress(), sha256: fileHash, watermarkId, registrar: record.registrar, creator, issuedAt: new Date().toISOString()};
    const message = claimMessage(fields);
    chainStatus('Sign the claim in your wallet (free, no transaction)…');
    const signature = await signer.signMessage(message);
    const certificate = {
      type: 'documark-proof-certificate', version: CERT_VERSION,
      network: {name: 'Ethereum Sepolia', chainId: Number(CHAIN_ID)}, ...fields,
      pHashRoot: record.phashRoot, pages: Number(record.pageCount),
      registeredAt: new Date(Number(record.registeredAt) * 1000).toISOString(),
      registerTransaction: own?.transactionHash || savedTx(fileHash) || null, blockNumber: own?.blockNumber ?? null,
      signer: account, message, signature
    };
    const blob = new Blob([`${JSON.stringify(certificate, null, 2)}\n`], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `documark-proof-${analysis.sha256.slice(0, 8)}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    chainStatus('Proof certificate downloaded. Share it with anyone; they can verify it here without a wallet.');
  } catch (error) {chainStatus(failure(error), true);}
}

function verdictRow(ok, text) {
  const row = document.createElement('p'); row.className = ok === null ? 'cert-note' : ok ? 'cert-ok' : 'cert-bad';
  row.textContent = `${ok === null ? '•' : ok ? '✓' : '✗'} ${text}`; return row;
}

async function verifyCertificate(file) {
  const box = $('#cert-verdict'); if (!box || !file) return;
  box.replaceChildren();
  const heading = document.createElement('h3'); box.append(heading);
  const rows = []; let valid = true;
  const add = (ok, text) => {rows.push(verdictRow(ok, text)); if (ok === false) valid = false;};
  try {
    if (file.size > 20000) throw new Error('This file is too large to be a proof certificate.');
    const cert = JSON.parse(await file.text());
    if (cert.type !== 'documark-proof-certificate' || cert.version !== CERT_VERSION) throw new Error('Not a DocuMark proof certificate.');
    if (!isAddress(cert.registry) || !isAddress(cert.registrar) || !/^0x[0-9a-fA-F]{64}$/.test(cert.sha256)) throw new Error('Certificate fields are malformed.');
    const expected = claimMessage(cert);
    add(cert.message === expected, 'The signed text matches the certificate fields.');
    let recovered = null;
    try { recovered = verifyMessage(cert.message, cert.signature); } catch {}
    add(!!recovered && recovered.toLowerCase() === cert.registrar.toLowerCase(), recovered ? `Signature was made by ${short(recovered)}.` : 'Signature is not valid.');
    const provider = await reader();
    const contract = await checkedContract(provider, cert.registry);
    const record = await contract.records(cert.sha256);
    const onChain = record.registrar !== ZeroAddress;
    add(onChain, onChain ? 'The file hash is registered on Sepolia.' : 'The file hash is not registered at this registry.');
    if (onChain) {
      add(record.registrar.toLowerCase() === cert.registrar.toLowerCase(), `The on-chain registrar is ${short(record.registrar)}${record.registrar.toLowerCase() === cert.registrar.toLowerCase() ? ', the signer.' : ', not the signer.'}`);
      add(record.phashRoot.toLowerCase() === String(cert.pHashRoot).toLowerCase() && Number(record.pageCount) === Number(cert.pages), 'Page count and pHash root match the chain.');
      if (cert.watermarkId) add((await contract.watermarks(cert.watermarkId)).toLowerCase() === cert.sha256.toLowerCase(), `Hidden watermark ID ${cert.watermarkId} points to this file on-chain.`);
      rows.push(verdictRow(null, `Registered ${new Date(Number(record.registeredAt) * 1000).toLocaleString()}.`));
    }
    rows.push(verdictRow(null, `Creator named in the certificate: ${cert.creator || '(none)'} — a claim made by the wallet owner, not verified.`));
    if (analysis) add(analysis.sha256.toLowerCase() === cert.sha256.slice(2).toLowerCase(), 'The file you analyzed has the same SHA-256 as the certificate.');
    else rows.push(verdictRow(null, 'To tie it to a file, analyze that file above, then verify again.'));
    heading.textContent = valid ? 'Certificate is valid' : 'Certificate failed verification';
  } catch (error) {
    heading.textContent = 'Certificate could not be verified';
    rows.push(verdictRow(false, failure(error)));
  }
  box.append(...rows);
  const note = document.createElement('p'); note.textContent = 'A valid certificate proves a wallet registered this hash by that time and signed this claim. It does not prove who created the document.'; box.append(note);
}

function fillRegistryInput() {
  const input = $('#registry-address');
  input.value = localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_SEPOLIA_REGISTRY_ADDRESS || '';
  input.addEventListener('change', () => {
    if (isAddress(input.value.trim())) localStorage.setItem(STORAGE_KEY, input.value.trim());
  });
}

export function initLookupPanel() {
  fillRegistryInput();
}

export function clearTrace() {
  const box = $('#extract-result'); if (box) {box.replaceChildren(); box.hidden = true;}
}

export async function showTrace(data) {
  const box = $('#extract-result'); box.replaceChildren(); box.hidden = false;
  const title = document.createElement('h2');
  title.textContent = data.found ? 'Hidden watermark found' : 'No hidden watermark found';
  box.append(title);
  if (!data.found) {
    const note = document.createElement('p'); note.className = 'scan-note';
    note.textContent = 'This copy has no readable DocuMark ID. If it is a phone photo, retake it with the whole page visible, flat and evenly lit, on a darker background. Heavy cropping, strong filters or a tiny image can also remove the mark.';
    box.append(note, resultRow('Signal strength', `${Math.round(Math.min(1, data.confidence) * 100)}%`));
    // An unchanged file can still be found by its exact SHA-256, even when it
    // was registered without a hidden watermark. This is separate from copy tracing.
    try {
      address();
      const contract = await checkedContract(await reader());
      const record = await contract.records(`0x${data.sha256}`);
      if (record.registrar !== ZeroAddress) {
        const exact = document.createElement('div'); exact.className = 'chain-verdict';
        const heading = document.createElement('h3'); heading.textContent = 'Exact file owner found'; exact.append(heading);
        exact.append(resultRow('Registered by', record.registrar), resultRow('Registered', new Date(Number(record.registeredAt) * 1000).toLocaleString()), resultRow('Original file SHA-256', `0x${data.sha256}`));
        const explain = document.createElement('p'); explain.textContent = 'This is an exact byte match. A resaved, photographed or edited copy still needs a hidden watermark ID to trace it.'; exact.append(explain);
        box.append(exact); chainStatus('Exact file lookup complete.');
      }
    } catch {}
    return;
  }
  box.append(resultRow('Hidden ID', data.watermark_id),
             resultRow('Signal strength', `${Math.round(Math.min(1, data.confidence) * 100)}%`),
             resultRow('How it was read', data.method === 'scanner' ? 'Page straightened by the scanner first' : 'Read directly'),
             resultRow('Page', data.page));
  const verdict = document.createElement('div'); verdict.className = 'chain-verdict'; box.append(verdict);
  const heading = document.createElement('h3'); verdict.append(heading);
  try {
    address();
    chainStatus('Looking up the hidden ID on Sepolia…');
    const contract = await checkedContract(await reader());
    const fileHash = await contract.watermarks(data.watermark_id);
    if (fileHash === ZeroHash) {
      heading.textContent = 'This hidden ID is not registered at this registry';
      const note = document.createElement('p'); note.textContent = 'The copy carries a DocuMark ID, but nobody has registered it here. Check that the registry address is the one the owner used.'; verdict.append(note);
      chainStatus('Lookup complete.');
      return;
    }
    const record = await contract.records(fileHash);
    let event = null;
    try { event = (await contract.queryFilter(contract.filters.DocumentRegistered(null, null, data.watermark_id), 0))[0] || null; } catch {}
    heading.textContent = 'Registered owner found on Sepolia';
    verdict.append(resultRow('Registered by', record.registrar),
                   resultRow('Registered', new Date(Number(record.registeredAt) * 1000).toLocaleString()),
                   resultRow('Original file SHA-256', fileHash), resultRow('Pages', record.pageCount.toString()));
    const links = document.createElement('p'); links.className = 'chain-links';
    links.append(link('View wallet ↗', `/address/${record.registrar}`));
    if (event) links.append(link('View registration ↗', `/tx/${event.transactionHash}`));
    verdict.append(links);
    const note = document.createElement('p');
    note.textContent = 'This copy carries the hidden ID of the registered original. Its own bytes can differ (resaved, resized or photographed); that is expected. The record shows which wallet registered the original and when; it does not prove who created it.';
    verdict.append(note);
    chainStatus('Lookup complete.');
  } catch (error) {
    heading.textContent = 'Could not look up the hidden ID';
    chainStatus(failure(error), true);
  }
}

export function initChainPanel() {
  fillRegistryInput();
  $('#connect-wallet').addEventListener('click', connectWallet);
  $('#deploy-registry').addEventListener('click', deployRegistry);
  $('#verify-cert').addEventListener('click', () => $('#cert-input').click());
  $('#cert-input').addEventListener('change', event => {verifyCertificate(event.target.files[0]); event.target.value = '';});
}

export function clearChainResult() {
  analysis = null;
  const box = $('#chain-result'); if (box) {box.replaceChildren();box.hidden = true;}
}

export function showChainAnalysis(data) {
  analysis = data;
  const box = $('#chain-result'); box.replaceChildren();
  const title = document.createElement('h2'); title.textContent = 'Document fingerprint';
  const note = document.createElement('p'); note.className = 'scan-note';
  note.textContent = 'The exact bytes of this file determine its SHA-256. Register the downloaded watermarked file if that is the version you plan to share.';
  const actions = document.createElement('div'); actions.className = 'scan-final-actions';
  actions.append(action('Check Sepolia registry', checkRecord), action('Register exact hash', registerRecord));
  const creatorField = document.createElement('div'); creatorField.className = 'field creator-field';
  const creatorLabel = document.createElement('label'); creatorLabel.htmlFor = 'creator-name'; creatorLabel.textContent = 'Creator name for the certificate (optional)';
  const creatorInput = document.createElement('input'); creatorInput.id = 'creator-name'; creatorInput.type = 'text'; creatorInput.maxLength = 80; creatorInput.autocomplete = 'off'; creatorInput.placeholder = 'Name or handle';
  const creatorHint = document.createElement('p'); creatorHint.className = 'field-hint'; creatorHint.textContent = 'Goes only into the signed certificate file, never on-chain. It is a claim by the wallet owner.';
  creatorField.append(creatorLabel, creatorInput, creatorHint);
  const certActions = document.createElement('div'); certActions.className = 'scan-final-actions';
  certActions.append(action('Sign & download proof certificate', downloadCertificate));
  const verdict = document.createElement('div'); verdict.id = 'registry-verdict'; verdict.className = 'chain-verdict';
  box.append(title, resultRow('Type', data.type), resultRow('Pages', data.pages),
             resultRow('SHA-256', `0x${data.sha256}`), resultRow('pHash root', `0x${data.phash_root}`),
             resultRow('Hidden watermark ID', data.watermark_id || 'None found (registers without one)'),
             note, actions, verdict, creatorField, certActions);
  box.hidden = false;
}
