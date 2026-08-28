// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateERC20} from "@coti-io/coti-contracts/contracts/token/PrivateERC20/PrivateERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VeilToken - a launch token with encrypted holder balances.
 *
 * Thin concrete wrapper over COTI's PrivateERC20. Balances live in contract
 * storage as ciphertext and only the holder's AES key turns them into a number;
 * `totalSupply()` returns 0 by design, because publishing an aggregate would
 * leak exactly what the encryption is protecting.
 *
 * The bonding curve is granted MINTER_ROLE and is the only address that can
 * create supply. It mints on buy and burns what it receives on sell, so the
 * curve's accounting never depends on reading an encrypted balance.
 */
contract VeilToken is PrivateERC20 {
    string public metadataURI;
    address public immutable creator;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address creator_,
        address minter
    ) PrivateERC20(name_, symbol_) {
        metadataURI = metadataURI_;
        creator = creator_;
        _grantRole(MINTER_ROLE, minter);
        _grantRole(DEFAULT_ADMIN_ROLE, creator_);
    }
}

/**
 * @title VeilPublicToken - the opt-out.
 *
 * A launcher who wants a conventional, fully transparent token gets a plain
 * ERC20 instead. Same curve, same graduation; no privacy claims made.
 */
contract VeilPublicToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    string public metadataURI;
    address public immutable creator;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address creator_,
        address minter
    ) ERC20(name_, symbol_) {
        metadataURI = metadataURI_;
        creator = creator_;
        _grantRole(MINTER_ROLE, minter);
        _grantRole(DEFAULT_ADMIN_ROLE, creator_);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
