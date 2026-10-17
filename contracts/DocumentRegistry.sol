// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Records who submitted an exact document fingerprint and when, using commit-reveal.
/// @dev Step 1, `commit`, publishes only a salted commitment, so observers cannot copy the file hash
///      from the mempool and register it first. Step 2, `register`, reveals the hash and salt in a later
///      block. The record is timestamped with the commit time. The per-page pHashes are emitted in the
///      event so that visually similar documents can be found off-chain. An optional 64-bit hidden
///      watermark ID (embedded invisibly in the page pixels) maps back to the record, so a resaved or
///      photographed copy can still be traced. The record does not prove authorship; file bytes and
///      personal data stay off-chain.
contract DocumentRegistry {
    struct Record {
        address registrar;
        uint64 registeredAt;
        uint16 pageCount;
        bytes32 phashRoot;
    }

    struct Commitment {
        address committer;
        uint64 committedAt;
        uint64 blockNumber;
    }

    mapping(bytes32 => Record) public records;
    mapping(bytes32 => Commitment) public commitments;
    mapping(bytes8 => bytes32) public watermarks;

    error InvalidFingerprint();
    error AlreadyRegistered();
    error AlreadyCommitted();
    error NoCommitment();
    error RevealTooSoon();
    error WatermarkTaken();

    event DocumentCommitted(bytes32 indexed commitment, address indexed committer);
    event DocumentRegistered(
        bytes32 indexed sha256,
        address indexed registrar,
        bytes8 indexed watermarkId,
        bytes32 phashRoot,
        uint16 pageCount,
        bytes pageHashes
    );

    /// @param commitment keccak256(abi.encodePacked(fileHash, watermarkId, msg.sender, salt))
    function commit(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert InvalidFingerprint();
        if (commitments[commitment].committer != address(0)) revert AlreadyCommitted();
        commitments[commitment] = Commitment(msg.sender, uint64(block.timestamp), uint64(block.number));
        emit DocumentCommitted(commitment, msg.sender);
    }

    /// @param pageHashes 8 bytes per page, in page order; sha256 of their lowercase hex must equal phashRoot.
    /// @param watermarkId hidden watermark ID in the pages, or zero when the file carries none.
    function register(
        bytes32 fileHash,
        bytes32 salt,
        bytes32 phashRoot,
        uint16 pageCount,
        bytes calldata pageHashes,
        bytes8 watermarkId
    ) external {
        if (fileHash == bytes32(0) || phashRoot == bytes32(0) || pageCount == 0 || pageCount > 20) {
            revert InvalidFingerprint();
        }
        if (pageHashes.length != uint256(pageCount) * 8 || sha256(_hexAscii(pageHashes)) != phashRoot) {
            revert InvalidFingerprint();
        }
        if (records[fileHash].registrar != address(0)) revert AlreadyRegistered();
        if (watermarkId != bytes8(0) && watermarks[watermarkId] != bytes32(0)) revert WatermarkTaken();
        bytes32 commitment = keccak256(abi.encodePacked(fileHash, watermarkId, msg.sender, salt));
        Commitment memory saved = commitments[commitment];
        if (saved.committer != msg.sender) revert NoCommitment();
        if (block.number <= saved.blockNumber) revert RevealTooSoon();

        delete commitments[commitment];
        records[fileHash] = Record(msg.sender, saved.committedAt, pageCount, phashRoot);
        if (watermarkId != bytes8(0)) watermarks[watermarkId] = fileHash;
        emit DocumentRegistered(fileHash, msg.sender, watermarkId, phashRoot, pageCount, pageHashes);
    }

    function _hexAscii(bytes calldata data) private pure returns (bytes memory out) {
        bytes16 digits = "0123456789abcdef";
        out = new bytes(data.length * 2);
        for (uint256 i = 0; i < data.length; i++) {
            uint8 value = uint8(data[i]);
            out[2 * i] = digits[value >> 4];
            out[2 * i + 1] = digits[value & 0x0f];
        }
    }
}
