# DocuMark

Learning project for computer-vision document watermarking and optional Ethereum Sepolia hash registration. The app provides sample documents, PDF/image handling, an adjustable circular visible seal, exact SHA-256 hashing, and per-page pHash.

## Run on Windows

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m samples.generate
.\.venv\Scripts\python.exe -m pytest -q -s
```

Use Python 3.12 or newer. The generated samples are synthetic and contain no personal data. The tests print PSNR, SSIM, and pHash Hamming distance; they verify that the PDF opens and that pHash remains close after JPEG quality 70.

`requirements.txt` pins everything the API and tests need.

## Run the web app

```powershell
npm.cmd install
npm.cmd run setup
npm.cmd run dev
```

Open `http://127.0.0.1:5173` on the computer. The Node/Vite frontend proxies `/api` to the Python CV backend, and `npm run dev` starts both. Frontend and backend code changes reload automatically. Restart `npm run dev` once after changing the dev script itself. On Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`; in Command Prompt, plain `npm` works. `npm run build` creates `frontend/dist`, which the Python server can also serve directly.

To scan with a phone camera, connect the phone and computer to the same Wi-Fi, start `npm.cmd run dev`, and open the **Network** URL printed by Vite on the phone (for example, `http://192.168.1.20:5173`). Open **Scan document** and tap **Take page photo with phone camera**. Capture one page at a time, then tap **Review scans** to adjust corners and filters and download a PDF or JPG. The camera button uses the browser's rear-camera file capture; camera behavior depends on the phone and browser. If the Network URL does not open, allow Node/Vite through the computer's firewall for the private network.

The app has Add watermark, Scan document, Inspect file, Sepolia proof, and Find owner. The scan workspace accepts up to 20 page photos (or one PDF for inspection). On a phone, use **Take page photo with phone camera** repeatedly to collect pages. After auto edge detection, drag the four crop corners, rotate, choose from Original, Auto enhance, Bright, Grayscale, and Black & white, reorder pages, and save a multi-page PDF. One-page scans can also be downloaded as JPG. **Add watermark to scanned PDF** carries the processed pages into the seal tool. The scan report also checks sharpness and looks for a centered circular seal pattern. Enter your name or organization, choose ink color, opacity, and seal size from 15% to 70%, and review the page preview before watermarking. Scanning and watermarking need no account or wallet. Files are processed in memory by the local Python server and returned as downloads. On-chain registration is optional and initiated from a browser wallet; file contents are never registered. Each upload is limited to 20 MB, a scan batch to 60 MB, and PDFs to 20 pages.

The interface follows the clear tool-card and upload-workspace pattern of [iLovePDF](https://www.ilovepdf.com/), using DocuMark branding and copy. The linked clone-app-pat-pro skill calls for Claude's Chrome extension and computed-style assertions; those tools are unavailable in this environment, so this is a functional design adaptation rather than a verified pixel-for-pixel clone.

`backend/app/cv/` functions receive pixel arrays and return pixel arrays or hashes. `pdf_to_images` renders a PDF at 200 DPI by default; `images_to_pdf` makes a PDF with page dimensions derived from DPI. Pixel arrays use RGB `uint8` throughout.

## How Phase 1 works

The visible watermark is a centered circular seal with double rings, the chosen name on its upper arc, and initials in the middle. On images, its transparent pixels are alpha blended with the page: for pixel `P`, ink `W`, and local opacity `a`, the output is `(1-a)P + aW`. The default opacity is 0.18 and default size is 35% of the shorter page dimension. On PDFs, the seal is inserted as a transparent image over each existing page, preserving selectable text and vector content.

pHash reduces an image to its low-frequency DCT structure, then converts it to a 64-bit pattern. JPEG compression often changes pixels without changing that broad structure. Compare page hashes by Hamming distance; SHA-256 remains the check for byte-identical files. `phash_root` hashes the ordered concatenation of page pHashes for later on-chain storage.

The scanner uses OpenCV edges and quadrilateral contours to find a photographed page, then applies a perspective transform to straighten it. Manual corner positions use the same transform. Enhance and Bright use local contrast adjustment; Grayscale removes color; Black & white uses adaptive thresholding. It measures edge sharpness with the variance of a Laplacian filter. To find the visible seal, it compares pixel brightness at the two expected circular rings against neighboring radii. This is a heuristic for the centered DocuMark-style seal, not a general watermark detector or proof that a document is authentic; another centered circular graphic can match, and a faint or transformed seal can be missed.

The scan workflow follows the capabilities described in [CamScanner's official developer page](https://dev.camscanner.com/?language=en-us): automatic edge crop, manual adjustment, image enhancement, and PDF/JPG output. It is an independent local implementation and does not include CamScanner's proprietary AI, OCR, cloud sync, or exact interface.

## Hidden watermark

**Add watermark** hides a random 64-bit ID in the page brightness by default (`backend/app/cv/invisible.py`); the visible seal is optional. Each page is resized to a fixed 256-pixel grid, and each of 80 coded bits (the ID plus a CRC-16) is repeated across 8x8 blocks chosen by a fixed shuffle. A bit is the sign of the difference between DCT coefficients (1,3) and (3,1). When reading, votes are summed per bit, and the CRC can repair up to two of the weakest bits; a result is reported only if the CRC matches and the signal is clearly above the level seen on unmarked pages. Only the brightness change is computed on the grid and scaled back onto the page, so resolution and color are kept. The change is about 3 grey levels (at most about 7), plus a 3-level brightness headroom so white paper does not clip the mark. On very plain white pages a faint texture can be visible up close.

The download shows the hidden ID. Register that exact file on Sepolia: the ID goes into the commitment and the record, and the contract refuses to link one ID to two files. **Find owner** reads the ID from a copy (PDF, image, screenshot or phone photo; photos are straightened by the scanner first) and looks up the registered owner on-chain, even though the copy's SHA-256 differs.

Measured on the generated samples: the ID is recovered from JPEG quality 50, half-size copies, 90-degree rotation, and a simulated phone photo (perspective, blur, noise, JPEG 85) after scanner straightening; unmarked pages are not reported (0 of 150 random IDs failed on simulated phone photos; 0 false detections in 1,200 unmarked readings). A raw photo without straightening, heavy cropping, or strong filters can remove the mark. A PDF with a hidden ID is rebuilt from 150-dpi page images, so its text is no longer selectable. The shuffle key is public; the mark identifies copies and is not meant to resist a deliberate removal attempt.

## Ethereum Sepolia proof

The optional `DocumentRegistry` Solidity contract stores an exact file SHA-256 hash, pHash root, page count, submitting wallet address, and the commit timestamp. Registration is commit-reveal: the first transaction publishes only a salted commitment, so nobody watching the mempool can copy your hash and register it first; the second transaction reveals the hash and salt. The reveal also emits the per-page pHashes (the contract checks they match the pHash root). It stores no file or name. The frontend signs deployment and registration through an injected browser wallet; the local server never handles a private key. Sepolia is Ethereum's contract test network, with chain ID `11155111`.

1. Run `npm.cmd run contract:test` to compile and test the contract on a local Hardhat EVM.
2. In your wallet, select Sepolia and obtain test ETH from a Sepolia faucet. Deployment and registration spend **test ETH** for gas.
3. Open **Sepolia proof** in the app. Click **Deploy test registry** and confirm in your wallet, or enter an existing registry address. The address is saved in this browser. To share a registry with other browsers, set `VITE_SEPOLIA_REGISTRY_ADDRESS` in `.env` or paste the same address.
4. Watermark and download a file, then use **Register proof** to analyze the exact downloaded bytes. Click **Register exact hash** and confirm **two** wallet transactions (commit, then reveal). The page shows both transaction hashes with Etherscan links. The salt is kept in this browser until the reveal succeeds; if the page is closed in between, registering again resumes at the reveal.
5. To check it later, upload the exact same bytes to **Sepolia proof**, use the same contract address, and click **Check Sepolia registry**. Read-only lookup uses the wallet's Sepolia provider when available, or the public RPC configured by `VITE_SEPOLIA_RPC_URL`.

After registering, the registering wallet can click **Sign & download proof certificate**: a JSON file with the file hash, registry, transaction, block time and a free wallet signature over a fixed claim text, plus an optional creator name that stays off-chain. Anyone can load it with **Verify a proof certificate** (no wallet needed) to check the signature and the on-chain record; analyze the file first to also confirm it has the same SHA-256. The certificate proves the wallet registered the hash and signed the claim; it does not prove who created the document.

No Sepolia address is bundled because deployment needs a wallet signature and test ETH. The local contract test confirms behavior, but it is not a Sepolia deployment. Resaving a document changes SHA-256, so the exact lookup will miss modified copies. **Check Sepolia registry** also scans the registry's event history for visually similar documents (at least 60% of pages within 10 of 64 pHash bits), so a resaved or re-exported copy is flagged with the earlier registrant and transaction. Registering a file that is similar to another wallet's record asks for confirmation first. Similarity is evidence only, and the earlier record is the stronger one. Commit-reveal does not stop someone who already holds your exact file from registering it first, so register before you share. After redeploying the contract, use the new registry address; records on an older registry stay there.

## Boundaries

A visible watermark is a deterrent and can be cropped or removed. A classical DWT-DCT watermark in a later phase will be a learning tool, not protection against a determined attacker. A chain registration proves only that a wallet submitted a hash at a time; it cannot prove authorship or authenticity. Use testnet only. The upload API enforces file size, type, image pixel count, and PDF page limits.
