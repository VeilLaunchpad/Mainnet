// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VeilNFTDrop, DropConfig} from "./VeilNFTDrop.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VeilNFTFactory - the studio. Deploys a collection, records it, steps back.
 *
 * Every collection gets its own contract, which is what makes a creator's terms
 * theirs: their supply, their price, their phases, their royalty. The factory
 * hands ownership over in the same transaction that deploys it and keeps no
 * power over what it made.
 *
 * Deployment is CREATE2 so an address can be mined before it exists, the same
 * way every token launch here ends in 8888. A collection carrying that mark is
 * recognisable at a glance, and a lookalike deployed elsewhere is not - which
 * on a marketplace is the difference that matters.
 *
 * The registry exists because a marketplace needs to enumerate collections and
 * the chain has no index. It records what was deployed and by whom; it does not
 * curate, and being listed here is not an endorsement. `VeilNFTMarket.official`
 * is the flag that means "ours", and only the marketplace owner can set it.
 */
contract VeilNFTFactory is Ownable, ReentrancyGuard {
    struct Collection {
        address addr;
        address creator;
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 mintPrice;
        address payToken;
        uint64 createdAt;
    }

    Collection[] private _collections;

    mapping(address => uint256[]) private _byCreator;
    /// collection => index + 1, so an address resolves to its record in one read.
    mapping(address => uint256) private _indexOf;

    /// What it costs to open a collection. Zero is a valid setting.
    uint256 public launchFee;
    address public feeRecipient;

    event Launched(
        address indexed collection,
        address indexed creator,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 mintPrice,
        address payToken
    );
    event LaunchFeeSet(uint256 fee, address recipient);

    error FeeTooLow();
    error NativeTransferFailed();
    error WrongAddress();

    constructor(address owner_, address feeRecipient_, uint256 launchFee_) Ownable(owner_) {
        require(feeRecipient_ != address(0), "fee recipient is zero");
        feeRecipient = feeRecipient_;
        launchFee = launchFee_;
    }

    function setLaunchFee(uint256 fee, address recipient) external onlyOwner {
        require(recipient != address(0), "fee recipient is zero");
        launchFee = fee;
        feeRecipient = recipient;
        emit LaunchFeeSet(fee, recipient);
    }

    /**
     * The arguments a drop is constructed with, as one struct.
     *
     * Solidity's stack runs out around sixteen locals and this has ten, so
     * grouping them is not tidiness - passing them loose does not compile.
     */
    struct DropParams {
        string name;
        string symbol;
        string previewURI;
        uint256 maxSupply;
        uint256 mintPrice;
        address payToken;
        uint256 maxPerWallet;
        uint64 presaleStart;
        uint64 publicStart;
    }

    /**
     * Opens a collection at an address mined in advance.
     *
     * `expected` is checked rather than trusted: the client mines a salt, and if
     * what lands is not what it predicted, the transaction reverts instead of
     * quietly giving somebody a different address than the one they were shown.
     * Pass the zero address to skip the check and take whatever CREATE2 gives.
     */
    function createDrop(
        bytes32 salt,
        DropParams calldata p,
        address expected
    ) external payable nonReentrant returns (address collection) {
        if (msg.value < launchFee) revert FeeTooLow();

        collection = _deploy(salt, p, msg.sender);
        if (expected != address(0) && collection != expected) revert WrongAddress();

        _collections.push(
            Collection({
                addr: collection,
                creator: msg.sender,
                name: p.name,
                symbol: p.symbol,
                maxSupply: p.maxSupply,
                mintPrice: p.mintPrice,
                payToken: p.payToken,
                createdAt: uint64(block.timestamp)
            })
        );
        _indexOf[collection] = _collections.length;
        _byCreator[msg.sender].push(_collections.length - 1);

        if (launchFee > 0) _sendNative(feeRecipient, launchFee);
        // Anything over the fee goes straight back rather than being kept.
        if (msg.value > launchFee) _sendNative(msg.sender, msg.value - launchFee);

        emit Launched(collection, msg.sender, p.name, p.symbol, p.maxSupply, p.mintPrice, p.payToken);
    }

    /**
     * The exact creation code a `createDrop` with these arguments will run.
     *
     * Written once and shared, rather than inlined into both callers: the
     * constructor takes ten arguments, and encoding them twice in separate
     * functions exhausted the stack even through the IR pipeline. One helper
     * also removes the chance of the two encodings drifting apart, which would
     * make a mined address silently wrong.
     */
    /** The creator owns the collection from its first block; this never does. */
    function _config(DropParams memory p, address creator) internal pure returns (DropConfig memory) {
        return DropConfig({
            name: p.name,
            symbol: p.symbol,
            previewURI: p.previewURI,
            maxSupply: p.maxSupply,
            mintPrice: p.mintPrice,
            payToken: p.payToken,
            maxPerWallet: p.maxPerWallet,
            presaleStart: p.presaleStart,
            publicStart: p.publicStart,
            owner: creator
        });
    }

    function _deploy(bytes32 salt, DropParams memory p, address creator) internal returns (address) {
        return address(new VeilNFTDrop{salt: salt}(_config(p, creator)));
    }

    function _initCode(DropParams memory p, address creator) internal pure returns (bytes memory) {
        return abi.encodePacked(type(VeilNFTDrop).creationCode, abi.encode(_config(p, creator)));
    }

    /**
     * The init code hash for one exact set of constructor arguments.
     *
     * Handed to the client so it can mine an 8888 salt locally with the standard
     * CREATE2 formula, without the creation code crossing the wire. Change any
     * argument and the hash changes, which is why a mined salt is only valid for
     * the arguments it was mined against.
     */
    function dropInitCodeHash(DropParams memory p, address creator) external pure returns (bytes32) {
        return keccak256(_initCode(p, creator));
    }

    /** The address a given salt would produce, so a caller can check first. */
    function predictDrop(bytes32 salt, DropParams memory p, address creator) external view returns (address) {
        bytes32 h = keccak256(_initCode(p, creator));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }

    /* ── the registry a marketplace reads ────────────────────────────────── */

    function collectionCount() external view returns (uint256) {
        return _collections.length;
    }

    function collectionAt(uint256 i) external view returns (Collection memory) {
        return _collections[i];
    }

    function collectionsOf(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    /** Whether this factory deployed a collection, and its record if so. */
    function isFromFactory(address collection) external view returns (bool from, Collection memory c) {
        uint256 slot = _indexOf[collection];
        if (slot == 0) return (false, c);
        return (true, _collections[slot - 1]);
    }

    /** A page of collections, newest first, so a marketplace can paginate. */
    function page(uint256 offset, uint256 limit) external view returns (Collection[] memory out) {
        uint256 total = _collections.length;
        if (offset >= total) return new Collection[](0);

        uint256 n = total - offset;
        if (n > limit) n = limit;
        out = new Collection[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _collections[total - 1 - offset - i];
        }
    }

    function _sendNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }
}
