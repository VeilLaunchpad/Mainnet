// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DevoxSwapPair} from "./DevoxSwapPair.sol";

/**
 * @title DevoxSwapFactory - one pair per token pair, deterministic and permissionless.
 *
 * Deliberately Uniswap V2's shape: tokens sorted by address, CREATE2 with the
 * sorted pair as salt, so a pair's address is derivable off-chain before it
 * exists and nobody can front-run a listing into a different address.
 */
contract DevoxSwapFactory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    address public feeTo;
    address public owner;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new DevoxSwapPair{salt: salt}());
        DevoxSwapPair(pair).initialize(token0, token1);

        // Both directions, so callers never have to sort.
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    /// The pair address for a token pair, whether or not it has been created.
    function pairFor(address tokenA, address tokenB) external view returns (address) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes32 initCodeHash = keccak256(type(DevoxSwapPair).creationCode);
        return
            address(
                uint160(
                    uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))
                )
            );
    }

    function setFeeTo(address to) external {
        if (msg.sender != owner) revert NotOwner();
        feeTo = to;
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        owner = to;
    }
}
