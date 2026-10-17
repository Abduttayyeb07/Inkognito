import {clearChainResult, clearTrace, initChainPanel, initLookupPanel, showChainAnalysis, showTrace} from './chain.js';

const icons = {
  watermark: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 3h13l5 5v21H7zM20 3v6h5M11 15h10M11 20h10M11 25h7"/><path d="m3 25 23-17"/></svg>',
  scan: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6M9 17h14M9 21h14M9 13h9"/></svg>',
  chain: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="8" width="24" height="18" rx="3"/><path d="M9 8V5h14v3M9 15h14M9 20h8"/><circle cx="23" cy="20" r="2"/></svg>',
  inspect: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3h14l5 5v17H6zM20 3v6h5M11 14h9M11 19h7"/><circle cx="23" cy="23" r="5"/><path d="m27 27 3 3"/></svg>',
  extract: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4c-5 0-9 4-9 9v3M25 13c0-5-4-9-9-9M11 28c1-3 2-7 2-12a3 3 0 0 1 6 0c0 6-1 10-3 13M20 28c1-3 2-6 2-10M8 21c1-2 1-4 1-5M24 22c.6-1.6 1-3.3 1-5"/></svg>'
};
const tools = {
  watermark: {title:'Add watermark', kicker:'DOCUMENT WATERMARK', description:'Hide a traceable ID in your PDF or image, with an optional visible seal.', panel:'Watermark options', panelDescription:'The hidden ID links every copy back to your Sepolia record.', accept:'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hint:'PDF, PNG or JPG • up to 20 MB • 20 pages', label:'Select a file', button:'Add watermark', multiple:false,
    options:`<label class="check-option"><input id="hidden-mark" type="checkbox" checked> Hidden ID watermark (invisible, traceable)</label>
      <label class="check-option"><input id="visible-seal" type="checkbox"> Also add a visible seal</label>
      <div id="seal-options" hidden><div class="seal-preview-wrap"><div class="seal-preview-label">PAGE PREVIEW</div><div class="seal-preview-page"><span></span><span></span><span></span><span></span><img id="seal-preview" alt="Circular watermark seal on page"></div><div class="seal-detail"><strong>SEAL DETAIL</strong><img id="seal-detail-preview" alt="Enlarged circular watermark seal"></div></div>
      <div class="field"><label for="watermark-text">Name or organization</label><input id="watermark-text" type="text" maxlength="40" placeholder="e.g. Acme Studio" autocomplete="organization"><p class="field-hint">This replaces the generic “PROTECTED” label.</p></div>
      <div class="field"><label for="ink-color">Ink color</label><select id="ink-color"><option value="slate">Soft slate</option><option value="blue">Classic blue</option><option value="red">Muted red</option></select></div>
      <div class="field"><label for="opacity">Opacity · <span id="opacity-value">18%</span></label><input id="opacity" type="range" min="5" max="45" value="18"><div class="range-labels"><span>Subtle</span><span>Stronger</span></div></div>
      <div class="field"><label for="seal-size">Seal size · <span id="size-value">35%</span></label><input id="seal-size" type="range" min="15" max="70" value="35"><div class="range-labels"><span>Small</span><span>Large</span></div></div></div>
      <label class="check-option"><input id="straighten-photo" type="checkbox"> Straighten photographed page before watermarking</label>
      <div class="option-callout">The hidden ID survives resaving, resizing, screenshots and phone photos. Register the downloaded file on Sepolia, then anyone can trace a copy with <strong>Find owner</strong>. A PDF with a hidden ID is rebuilt from page images, so its text is no longer selectable.</div>`},
  scan: {title:'Scan document', kicker:'PHOTO TO DOCUMENT', description:'Capture pages, correct their edges, enhance the image, and save a clean PDF.', panel:'Scan pages', panelDescription:'Add up to 20 page photos or one PDF for inspection.', accept:'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hint:'PDF or up to 20 PNG/JPG photos • 20 MB each', label:'Add pages', button:'Review scans', multiple:true,
    options:'<div class="option-callout">Auto crop finds page edges. After scanning, drag corners, choose a filter, rotate, and reorder pages before saving a PDF or adding a watermark.</div>'},
  inspect: {title:'Inspect file', kicker:'DOCUMENT DETAILS', description:'View exact and perceptual fingerprints for a PDF or image.', panel:'File details', panelDescription:'Upload a file to calculate its fingerprints.', accept:'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hint:'PDF, PNG or JPG • up to 20 MB • 20 pages', label:'Select a file', button:'Inspect file', multiple:false,
    options:'<div class="option-callout">SHA-256 changes when file bytes change. pHash captures each page’s broad visual structure and can stay similar after compression.</div>'},
  chain: {title:'Sepolia proof', kicker:'ETHEREUM TESTNET', description:'Check or register an exact document fingerprint on Ethereum Sepolia.', panel:'Registry', panelDescription:'No file or personal details go on-chain.', accept:'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hint:'PDF, PNG or JPG • up to 20 MB • 20 pages', label:'Select a file', button:'Analyze file', multiple:false,
    options:'<div class="field"><label for="registry-address">Registry contract address</label><input id="registry-address" type="text" placeholder="0x…" autocomplete="off"><p class="field-hint">Paste a deployed Sepolia registry address or deploy your own below.</p></div><button type="button" id="connect-wallet" class="camera-button">Connect Sepolia wallet</button><button type="button" id="deploy-registry" class="camera-button">Deploy test registry</button><button type="button" id="verify-cert" class="camera-button">Verify a proof certificate (.json)</button><input id="cert-input" type="file" accept="application/json,.json" hidden><div id="chain-status" class="status" role="status" aria-live="polite"></div><div id="cert-verdict" class="chain-verdict"></div><div class="option-callout">Only the SHA-256 hash, page count, and pHash root are registered. A record shows which wallet submitted the hash and when; it does not prove authorship. A signed proof certificate adds a wallet signature and an optional creator name, which you can share with others.</div>'},
  extract: {title:'Find owner', kicker:'HIDDEN WATERMARK', description:'Read the hidden ID from a copy, such as a resaved PDF, a screenshot or a phone photo, and look up who registered it on Sepolia.', panel:'Trace a copy', panelDescription:'No wallet needed. Only the hidden ID is looked up.', accept:'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hint:'PDF, PNG or JPG • up to 20 MB • 20 pages', label:'Select a copy', button:'Find hidden ID', multiple:false,
    options:'<div class="field"><label for="registry-address">Registry contract address</label><input id="registry-address" type="text" placeholder="0x…" autocomplete="off"><p class="field-hint">The Sepolia registry where the original was registered.</p></div><div id="chain-status" class="status" role="status" aria-live="polite"></div><div class="option-callout">For a phone photo, show the whole page on a darker background so the scanner can find its edges and straighten it.</div>'}
};

const $ = (selector) => document.querySelector(selector);
const state = {tool:null, files:[], downloadUrl:null, busy:false, handoffFile:null, scanStraighten:false, scanPages:[]};
let previewTimer;
document.querySelectorAll('[data-icon]').forEach(node => node.innerHTML = icons[node.dataset.icon]);

function route() {
  clearTimeout(previewTimer);
  const requested = location.hash.slice(1);
  const key = requested in tools ? requested : 'watermark';
  const tool = tools[key];
  document.body.dataset.tool = key;
  if (state.tool !== key) {state.files = ['watermark','chain'].includes(key) && state.handoffFile ? [state.handoffFile] : []; state.handoffFile = null; clearResult(); state.tool = key;}
  document.querySelectorAll('.main-nav a').forEach(link => {
    if (link.hash === `#${key}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#workspace-kicker').textContent = tool.kicker;
  $('#workspace-title').textContent = tool.title;
  $('#workspace-description').textContent = tool.description;
  const guide = $('#workspace-guide');
  if (guide) guide.textContent = key === 'watermark' ? '1. Choose your file  2. Keep Hidden ID on  3. Download the protected copy' : key === 'scan' ? '1. Photograph each page  2. Check the crop  3. Save as PDF or add a watermark' : key === 'chain' ? '1. Analyze the downloaded file  2. Connect your wallet  3. Register when ready' : key === 'extract' ? '1. Choose the copy  2. Keep the same registry address  3. Find the hidden ID or exact file owner' : '1. Choose a file  2. View its fingerprints  3. Use SHA-256 for an exact match';
  $('#workspace-symbol').innerHTML = icons[key];
  $('#panel-title').textContent = tool.panel;
  $('#panel-description').textContent = tool.panelDescription;
  $('#tool-options').innerHTML = tool.options;
  if (key==='chain') initChainPanel();
  if (key==='extract') initLookupPanel();
  const straighten = $('#straighten-photo'); if (straighten) straighten.checked = state.scanStraighten;
  $('#camera-entry').hidden = !['scan','extract'].includes(key);
  state.scanStraighten = false;
  $('#file-input').accept = tool.accept;
  $('#file-input').multiple = tool.multiple;
  $('#choose-label').innerHTML = `${tool.label} <span aria-hidden="true">→</span>`;
  $('#upload-hint').textContent = tool.hint;
  $('#status').textContent = '';
  $('#status').classList.remove('error');
  const opacity = $('#opacity'); if (opacity) opacity.addEventListener('input', () => {$('#opacity-value').textContent = `${opacity.value}%`; updateSealPreview();});
  const size = $('#seal-size'); if (size) size.addEventListener('input', () => {$('#size-value').textContent = `${size.value}%`; updateSealPreview();});
  const name = $('#watermark-text'); if (name) name.addEventListener('input', () => {updateSealPreview(); renderFiles();});
  const ink = $('#ink-color'); if (ink) ink.addEventListener('change', updateSealPreview);
  for (const id of ['#hidden-mark', '#visible-seal']) { const box = $(id); if (box) box.addEventListener('change', () => {$('#seal-options').hidden = !$('#visible-seal').checked; renderFiles();}); }
  updateSealPreview();
  renderFiles(); window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange', route); route();

function updateSealPreview() {
  const preview = $('#seal-preview');
  if (!preview) return;
  const detail = $('#seal-detail-preview');
  preview.style.width = `${$('#seal-size').value}%`;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const params = new URLSearchParams({
      text: $('#watermark-text').value.trim() || 'YOUR NAME',
      opacity: String(Number($('#opacity').value) / 100),
      color: $('#ink-color').value
    });
    preview.src = `/api/seal-preview?${params}`;
    detail.src = preview.src;
  }, 150);
}

const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => $('#file-input').click());
dropzone.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); $('#file-input').click();}});
for (const type of ['dragenter','dragover']) dropzone.addEventListener(type, event => {event.preventDefault(); dropzone.classList.add('dragging');});
for (const type of ['dragleave','drop']) dropzone.addEventListener(type, event => {event.preventDefault(); dropzone.classList.remove('dragging');});
dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
$('#file-input').addEventListener('change', event => {addFiles(event.target.files); event.target.value = '';});
$('#camera-input').addEventListener('change', event => {addFiles(event.target.files); event.target.value = '';});
$('#camera-button').addEventListener('click', () => $('#camera-input').click());

function setStatus(message, error=false) {const node=$('#status'); node.textContent=message; node.classList.toggle('error',error);}
function clearResult() {
  $('#result-panel').hidden=true; $('#inspect-result').hidden=true; $('#scan-result').hidden=true; $('#register-result-button').hidden=true;clearChainResult();clearTrace();
  if(state.downloadUrl){URL.revokeObjectURL(state.downloadUrl);state.downloadUrl=null;}
  state.scanPages.forEach(page=>{if(page.sourceUrl)URL.revokeObjectURL(page.sourceUrl);if(page.previewUrl)URL.revokeObjectURL(page.previewUrl);});
  state.scanPages=[];
}
function validFile(file) {const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'; const isImage = /\.(png|jpe?g)$/i.test(file.name) || /^image\/(png|jpeg)$/.test(file.type); return isPdf||isImage;}
function addFiles(incoming) {
  if (!state.tool || state.busy) return;
  const files=Array.from(incoming);
  if (!files.length) return;
  if (files.some(file => !validFile(file))) {setStatus('Choose a supported PDF, PNG or JPG file for this tool.',true);return;}
  if (files.some(file => file.size > 20*1024*1024)) {setStatus('Each file must be 20 MB or smaller.',true);return;}
  if(state.tool==='scan') {
    const combined=[...state.files,...files];
    if(combined.length>20){setStatus('Choose up to 20 pages.',true);return;}
    if(combined.some(file=>/\.pdf$/i.test(file.name)||file.type==='application/pdf')&&combined.length>1){setStatus('Scan one PDF at a time, or add multiple photos.',true);return;}
    state.files=combined;
  } else state.files=[files[0]];
  clearResult(); setStatus(''); renderFiles();
  if (!['scan','chain'].includes(state.tool)) inspectSummary(state.files[0]);
}
function renderFiles() {
  const list=$('#file-list'); list.replaceChildren();
  state.files.forEach((file,index) => {
    const row=document.createElement('div');row.className='file-item';
    const badge=document.createElement('span');badge.className='file-badge';badge.textContent=/\.pdf$/i.test(file.name)?'PDF':'IMG';
    const text=document.createElement('div');text.className='file-text';const name=document.createElement('div');name.className='file-name';name.textContent=file.name;const meta=document.createElement('div');meta.className='file-meta';meta.textContent=`${(file.size/1024/1024).toFixed(2)} MB`;text.append(name,meta);
    const remove=document.createElement('button');remove.type='button';remove.className='remove-file';remove.setAttribute('aria-label',`Remove ${file.name}`);remove.textContent='×';remove.addEventListener('click',()=>{state.files.splice(index,1);clearResult();renderFiles();});
    row.append(badge,text,remove);list.append(row);
  });
  const visibleSeal = state.tool === 'watermark' && $('#visible-seal').checked;
  const anyMark = state.tool !== 'watermark' || $('#hidden-mark').checked || visibleSeal;
  const hasName = !visibleSeal || !!$('#watermark-text').value.trim();
  const ready=(state.tool==='scan'?state.files.length>0:state.files.length===1) && hasName && anyMark;
  const button=$('#process-button');button.disabled=!ready||state.busy;
  const label=state.tool==='scan'&&state.scanPages.length?'Rescan pages':tools[state.tool].button;
  button.innerHTML=ready?`${label} <span aria-hidden="true">→</span>`:(!state.files.length ? 'Choose a file to continue' : !anyMark ? 'Choose hidden ID or visible seal' : 'Enter a name for the seal');
  if(!state.files.length) $('#file-summary').hidden=true;
}
async function inspectSummary(file) {
  const current=file;
  try {
    const form=new FormData();form.append('file',file);
    const response=await fetch('/api/inspect',{method:'POST',body:form});
    if(!response.ok) throw new Error(await responseError(response));
    const result=await response.json();
    if(state.files[0]!==current) return;
    const box=$('#file-summary');box.textContent=`${result.type} · ${result.pages} ${result.pages===1?'page':'pages'} · SHA-256 starts ${result.sha256.slice(0,12)}…`;box.hidden=false;
  } catch(error) {if(state.files[0]===current) setStatus(error.message,true);}
}
async function responseError(response) {try {const body=await response.json();return typeof body.detail==='string'?body.detail:`Request failed (${response.status})`;}catch{return `Request failed (${response.status})`;}}
function filenameFrom(response,fallback) {const match=/filename="?([^";]+)"?/i.exec(response.headers.get('Content-Disposition')||'');return match?.[1]||fallback;}
function detailRow(label,value) {const row=document.createElement('div');row.className='fingerprint-row';const title=document.createElement('strong');title.textContent=label;const detail=document.createElement('code');detail.textContent=value;row.append(title,detail);return row;}
function showInspect(data) {const box=$('#inspect-result');box.replaceChildren();const heading=document.createElement('h2');heading.textContent='File fingerprints';box.append(heading,detailRow('Type',data.type),detailRow('Pages',String(data.pages)),detailRow('Size',`${(data.size_bytes/1024/1024).toFixed(2)} MB`),detailRow('SHA-256',data.sha256),detailRow('pHash root',data.phash_root));data.phashes.forEach((hash,index)=>box.append(detailRow(`Page ${index+1} pHash`,hash)));box.hidden=false;}
function scanButton(label, className, action) {
  const button=document.createElement('button');button.type='button';button.className=className;button.textContent=label;button.addEventListener('click',action);return button;
}
function fullCorners() {return [[0,0],[1,0],[1,1],[0,1]];}
function scanSettings(page) {return {corners:page.corners,mode:page.mode,rotation:page.rotation};}
function showPdfScan(data) {
  const box=$('#scan-result');box.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='PDF scan report';box.append(heading);
  const summary=document.createElement('p');summary.className='scan-summary';summary.textContent=`${data.pages} ${data.pages===1?'page':'pages'} · ${data.seal_detected?'Possible circular seal found':'No matching circular seal found'}`;box.append(summary);
  data.results.forEach(result=>{
    const row=document.createElement('div');row.className='scan-page';
    const title=document.createElement('strong');title.textContent=`Page ${result.page}`;
    const detail=document.createElement('p');detail.textContent=`${result.width} × ${result.height} px · ${result.quality} · ${result.seal_detected?'possible seal':'no matching seal'}`;
    row.append(title,detail);box.append(row);
  });
  const note=document.createElement('p');note.className='scan-note';note.textContent='The visual seal check is a heuristic and does not authenticate this PDF.';box.append(note);
  box.append(scanButton('Add watermark to this PDF →','scan-action',()=>{state.handoffFile=state.files[0];location.hash='#watermark';}));
  box.hidden=false;
}
async function refreshScanPreview(page) {
  const token=(page.previewToken||0)+1;page.previewToken=token;
  if(page.previewImage) page.previewImage.classList.add('loading');
  try {
    const form=new FormData();form.append('file',page.file);form.append('settings',JSON.stringify(scanSettings(page)));
    const response=await fetch('/api/scan-render',{method:'POST',body:form});
    if(!response.ok) throw new Error(await responseError(response));
    const blob=await response.blob();
    if(page.previewToken!==token||!state.scanPages.includes(page)) return;
    const url=URL.createObjectURL(blob);
    if(page.previewUrl) URL.revokeObjectURL(page.previewUrl);
    page.previewUrl=url;page.previewImage.src=url;page.previewImage.classList.remove('loading');
  } catch(error){if(page.previewToken===token)setStatus(error.message,true);}
}
function updateCropOverlay(page) {
  if(!page.cropPolygon)return;
  page.cropPolygon.setAttribute('points',page.corners.map(point=>`${point[0]*100},${point[1]*100}`).join(' '));
  page.cropHandles.forEach((handle,index)=>{handle.style.left=`${page.corners[index][0]*100}%`;handle.style.top=`${page.corners[index][1]*100}%`;});
}
function scanPageCard(page,index) {
  const card=document.createElement('article');card.className='scan-editor-card';
  const header=document.createElement('div');header.className='scan-editor-header';
  const heading=document.createElement('div');const title=document.createElement('h3');title.textContent=`Page ${index+1}`;const subtitle=document.createElement('p');subtitle.textContent=`${page.file.name} · ${page.info.quality} · ${page.info.seal_detected?'possible circular seal':'no matching circular seal'}`;heading.append(title,subtitle);
  const order=document.createElement('div');order.className='scan-order';
  order.append(scanButton('↑','scan-mini',()=>moveScanPage(index,-1)),scanButton('↓','scan-mini',()=>moveScanPage(index,1)),scanButton('×','scan-mini',()=>removeScanPage(index)));
  header.append(heading,order);card.append(header);
  const visuals=document.createElement('div');visuals.className='scan-visuals';
  const original=document.createElement('div');original.className='scan-visual';const originalLabel=document.createElement('strong');originalLabel.textContent='Adjust crop · drag corners';
  const stage=document.createElement('div');stage.className='scan-stage';stage.style.aspectRatio=`${page.info.source_width} / ${page.info.source_height}`;
  const source=document.createElement('img');source.src=page.sourceUrl;source.alt=`Original photo for page ${index+1}`;stage.append(source);
  const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.setAttribute('viewBox','0 0 100 100');overlay.setAttribute('preserveAspectRatio','none');overlay.classList.add('scan-overlay');
  const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');overlay.append(polygon);stage.append(overlay);page.cropPolygon=polygon;page.cropHandles=[];
  for(let corner=0;corner<4;corner++) {
    const handle=document.createElement('button');handle.type='button';handle.className='crop-handle';handle.setAttribute('aria-label',`Move corner ${corner+1} of page ${index+1}`);
    handle.addEventListener('pointerdown',event=>{event.preventDefault();handle.setPointerCapture(event.pointerId);});
    handle.addEventListener('pointermove',event=>{
      if(!handle.hasPointerCapture(event.pointerId))return;
      const rect=stage.getBoundingClientRect();page.corners[corner]=[Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];updateCropOverlay(page);
    });
    handle.addEventListener('pointerup',()=>refreshScanPreview(page));
    stage.append(handle);page.cropHandles.push(handle);
  }
  original.append(originalLabel,stage);
  const output=document.createElement('div');output.className='scan-visual';const outputLabel=document.createElement('strong');outputLabel.textContent='Processed preview';
  const preview=document.createElement('img');preview.className=`scan-preview${page.previewUrl?'':' loading'}`;preview.alt=`Processed page ${index+1}`;if(page.previewUrl)preview.src=page.previewUrl;page.previewImage=preview;output.append(outputLabel,preview);
  visuals.append(original,output);card.append(visuals);updateCropOverlay(page);
  const controls=document.createElement('div');controls.className='scan-controls';
  const mode=document.createElement('select');mode.setAttribute('aria-label',`Filter for page ${index+1}`);
  for(const [value,label] of [['enhance','Auto enhance'],['bright','Bright'],['grayscale','Grayscale'],['bw','Black & white'],['original','Original']]){const option=document.createElement('option');option.value=value;option.textContent=label;mode.append(option);}mode.value=page.mode;
  mode.addEventListener('change',()=>{page.mode=mode.value;refreshScanPreview(page);});
  controls.append(mode,scanButton('Rotate 90°','scan-mini',()=>{page.rotation=(page.rotation+90)%360;refreshScanPreview(page);}));
  controls.append(scanButton('Auto crop','scan-mini',()=>{page.corners=page.info.corners?.map(point=>[...point])||fullCorners();updateCropOverlay(page);refreshScanPreview(page);}));
  controls.append(scanButton('Full image','scan-mini',()=>{page.corners=fullCorners();updateCropOverlay(page);refreshScanPreview(page);}));
  card.append(controls);return card;
}
function moveScanPage(index,direction) {
  const target=index+direction;if(target<0||target>=state.scanPages.length)return;
  [state.scanPages[index],state.scanPages[target]]=[state.scanPages[target],state.scanPages[index]];
  [state.files[index],state.files[target]]=[state.files[target],state.files[index]];
  renderFiles();renderScanEditor();
}
function removeScanPage(index) {
  const [page]=state.scanPages.splice(index,1);state.files.splice(index,1);
  if(page.sourceUrl)URL.revokeObjectURL(page.sourceUrl);if(page.previewUrl)URL.revokeObjectURL(page.previewUrl);
  if(!state.scanPages.length){clearResult();renderFiles();return;}
  renderFiles();renderScanEditor();
}
function renderScanEditor() {
  const box=$('#scan-result');box.replaceChildren();
  const heading=document.createElement('div');heading.className='scan-report-head';
  const title=document.createElement('h2');title.textContent=`Review ${state.scanPages.length} ${state.scanPages.length===1?'page':'pages'}`;
  const tip=document.createElement('p');tip.textContent='Adjust the blue corners, then choose a look. The preview matches your download.';
  heading.append(title,tip);box.append(heading);
  state.scanPages.forEach((page,index)=>box.append(scanPageCard(page,index)));
  const actions=document.createElement('div');actions.className='scan-final-actions';
  actions.append(scanButton('Download scanned PDF','scan-action',()=>downloadProcessedScan('pdf')));
  if(state.scanPages.length===1) actions.append(scanButton('Download JPG','scan-export',()=>downloadProcessedScan('jpg')));
  actions.append(scanButton('Add watermark to scanned PDF →','scan-export',handoffProcessedScan));box.append(actions);
  const note=document.createElement('p');note.className='scan-note';note.textContent='Circular seal detection is visual only. It cannot prove a document is authentic.';box.append(note);
  box.hidden=false;
}
async function scanPdfBlob() {
  const form=new FormData();
  state.scanPages.forEach(page=>form.append('files',page.file));
  form.append('settings',JSON.stringify(state.scanPages.map(scanSettings)));
  const response=await fetch('/api/scan-batch',{method:'POST',body:form});
  if(!response.ok)throw new Error(await responseError(response));
  return response.blob();
}
async function downloadProcessedScan(format) {
  if(state.busy||!state.scanPages.length)return;
  state.busy=true;renderFiles();setStatus('Preparing your scan…');
  try {
    let blob,filename;
    if(format==='pdf'){blob=await scanPdfBlob();filename='scanned-pages.pdf';}
    else {
      const page=state.scanPages[0],form=new FormData();form.append('file',page.file);form.append('settings',JSON.stringify(scanSettings(page)));form.append('output','jpg');
      const response=await fetch('/api/scan-render',{method:'POST',body:form});if(!response.ok)throw new Error(await responseError(response));blob=await response.blob();filename='scanned-page.jpg';
    }
    if(state.downloadUrl)URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl=URL.createObjectURL(blob);const link=$('#download-link');link.href=state.downloadUrl;link.download=filename;
    $('#result-title').textContent='Your scan is ready';$('#result-description').textContent=`${filename} · ${(blob.size/1024/1024).toFixed(2)} MB`;$('#result-panel').hidden=false;
    setStatus('Scan ready to download.');$('#result-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(error){setStatus(error.message,true);}finally{state.busy=false;renderFiles();}
}
async function handoffProcessedScan() {
  if(state.busy||!state.scanPages.length)return;
  state.busy=true;renderFiles();setStatus('Preparing scanned PDF for watermarking…');
  try {
    const blob=await scanPdfBlob();state.handoffFile=new File([blob],'scanned-pages.pdf',{type:'application/pdf'});
    state.scanStraighten=false;location.hash='#watermark';
  }catch(error){setStatus(error.message,true);}finally{state.busy=false;renderFiles();}
}
async function performScan() {
  if(state.files.length===1&&(/\.pdf$/i.test(state.files[0].name)||state.files[0].type==='application/pdf')) {
    const form=new FormData();form.append('file',state.files[0]);const response=await fetch('/api/scan',{method:'POST',body:form});
    if(!response.ok)throw new Error(await responseError(response));showPdfScan(await response.json());return;
  }
  for(let index=0;index<state.files.length;index++) {
    setStatus(`Finding page edges ${index+1} of ${state.files.length}…`);
    const file=state.files[index],form=new FormData();form.append('file',file);
    const response=await fetch('/api/scan',{method:'POST',body:form});if(!response.ok)throw new Error(await responseError(response));
    const data=await response.json(),info=data.results[0];
    state.scanPages.push({file,info,corners:info.corners?.map(point=>[...point])||fullCorners(),mode:'enhance',rotation:0,sourceUrl:URL.createObjectURL(file),previewUrl:null,previewToken:0});
  }
  renderScanEditor();
  for(const page of state.scanPages)await refreshScanPreview(page);
}
$('#process-button').addEventListener('click',async()=>{
  if(state.busy||!state.files.length)return;
  clearResult();state.busy=true;renderFiles();setStatus('Processing your file…');
  const form=new FormData();
  form.append('file',state.files[0]);
  if(state.tool==='watermark'){form.append('hidden',String($('#hidden-mark').checked));form.append('visible',String($('#visible-seal').checked));form.append('text',$('#watermark-text').value);form.append('opacity',String(Number($('#opacity').value)/100));form.append('color',$('#ink-color').value);form.append('size',String(Number($('#seal-size').value)/100));form.append('straighten',String($('#straighten-photo').checked));}
  try {
    if(state.tool==='scan'){await performScan();setStatus('Review your scanned pages below.');$('#scan-result').scrollIntoView({behavior:'smooth',block:'start'});return;}
    const response=await fetch(`/api/${state.tool==='chain'?'inspect':state.tool}`,{method:'POST',body:form});
    if(!response.ok)throw new Error(await responseError(response));
    if(state.tool==='inspect'){showInspect(await response.json());setStatus('Inspection complete.');}
    else if(state.tool==='extract'){const data=await response.json();setStatus(data.found?'Hidden ID found. Looking it up on Sepolia…':'No hidden ID found in this copy.',!data.found);await showTrace(data);$('#extract-result').scrollIntoView({behavior:'smooth',block:'nearest'});}
    else if(state.tool==='chain'){showChainAnalysis(await response.json());setStatus('Fingerprint ready. Check or register it below.');$('#chain-result').scrollIntoView({behavior:'smooth',block:'nearest'});}
    else {const blob=await response.blob();state.downloadUrl=URL.createObjectURL(blob);const filename=filenameFrom(response,'document.pdf');const link=$('#download-link');link.href=state.downloadUrl;link.download=filename;$('#result-title').textContent='Your file is ready';const hiddenId=response.headers.get('X-Watermark-Id');$('#result-description').textContent=`${filename} · ${(blob.size/1024/1024).toFixed(2)} MB${hiddenId?` · Hidden ID ${hiddenId}`:''}`;$('#result-panel').hidden=false;$('#register-result-button').hidden=false;state.markedFile=new File([blob],filename,{type:blob.type});setStatus(hiddenId?'Finished. Register this exact download on Sepolia to make the hidden ID traceable.':'Finished. Your download is ready.');$('#result-panel').scrollIntoView({behavior:'smooth',block:'nearest'});}
  } catch(error){if(state.tool==='scan')clearResult();setStatus(error.message,true);}
  finally{state.busy=false;renderFiles();}
});
$('#register-result-button').addEventListener('click',()=>{if(!state.markedFile)return;state.handoffFile=state.markedFile;location.hash='#chain';});
