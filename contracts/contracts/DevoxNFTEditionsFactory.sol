// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DevoxNFTEditions, EditionsConfig} from "./DevoxNFTEditions.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DevoxNFTEditionsFactory - the open-collection half of the studio.
 *
 * A sibling of `DevoxNFTFactory` rather than an extension of it. The drop
 * factory is already live with the official collection registered inside it,
 * and widening its `Collection` struct to carry a kind flag would have meant
 * redeploying, re-mining an 8888 address and re-sealing the metadata - throwing
 * away a working deployment to avoid having two contracts. Two registries the
 * app reads side by side is the cheaper honesty.
 *
 * The registry shape is deliberately identical to the drop factory's so a
 * marketplace can page both with the same code.
 */
contract DevoxNFTEditionsFactory is Ownable, ReentrancyGuard {
    struct Collection {
        address addr;
        address creator;
        string name;
        string symbol;
        uint64 createdAt;
    }

    Collection[] private _collections;
    mapping(address => uint256[]) private _byCreator;
    mapping(address => uint256) private _indexOf;

    uint256 public launchFee;
    address public feeRecipient;

    event Launched(address indexed collection, address indexed creator, string name, string symbol);
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

    struct EditionsParams {
        string name;
        string symbol;
        string previewURI;
    }

    /** Opens a collection at an address mined in advance, same as a drop. */
    function createEditions(bytes32 salt, EditionsParams calldata p, address expected)
        external
        payable
        nonReentrant
        returns (address collection)
    {
        if (msg.value < launchFee) revert FeeTooLow();

        collection = _deploy(salt, p, msg.sender);
        if (expected != address(0) && collection != expected) revert WrongAddress();

        _collections.push(
            Collection({
                addr: collection,
                creator: msg.sender,
                name: p.name,
                symbol: p.symbol,
                createdAt: uint64(block.timestamp)
            })
        );
        _indexOf[collection] = _collections.length;
        _byCreator[msg.sender].push(_collections.length - 1);

        if (launchFee > 0) _sendNative(feeRecipient, launchFee);
        if (msg.value > launchFee) _sendNative(msg.sender, msg.value - launchFee);

        emit Launched(collection, msg.sender, p.name, p.symbol);
    }

    function _config(EditionsParams memory p, address creator) internal pure returns (EditionsConfig memory) {
        return EditionsConfig({name: p.name, symbol: p.symbol, previewURI: p.previewURI, owner: creator});
    }

    function _deploy(bytes32 salt, EditionsParams memory p, address creator) internal returns (address) {
        return address(new DevoxNFTEditions{salt: salt}(_config(p, creator)));
    }

    function _initCode(EditionsParams memory p, address creator) internal pure returns (bytes memory) {
        return abi.encodePacked(type(DevoxNFTEditions).creationCode, abi.encode(_config(p, creator)));
    }

    function editionsInitCodeHash(EditionsParams memory p, address creator) external pure returns (bytes32) {
        return keccak256(_initCode(p, creator));
    }

    function predictEditions(bytes32 salt, EditionsParams memory p, address creator)
        external
        view
        returns (address)
    {
        bytes32 h = keccak256(_initCode(p, creator));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }

    function collectionCount() external view returns (uint256) {
        return _collections.length;
    }

    function collectionAt(uint256 i) external view returns (Collection memory) {
        return _collections[i];
    }

    function collectionsOf(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    function isFromFactory(address collection) external view returns (bool from, Collection memory c) {
        uint256 slot = _indexOf[collection];
        if (slot == 0) return (false, c);
        return (true, _collections[slot - 1]);
    }

    function page(uint256 offset, uint256 limit) external view returns (Collection[] memory out) {
        uint256 total = _collections.length;
        if (offset >= total) return new Collection[](0);
        uint256 n = total - offset;
        if (n > limit) n = limit;
        out = new Collection[](n);
        for (uint256 i = 0; i < n; i++) out[i] = _collections[total - 1 - offset - i];
    }

    function _sendNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }
}
