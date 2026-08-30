// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DevoxToken, DevoxPublicToken} from "./DevoxToken.sol";

/**
 * Token creation code lives here, not in the factory.
 *
 * A COTI PrivateERC20 is a large contract, and embedding both token variants'
 * creation code in the factory pushed it past the 24KB deployment limit.
 * Splitting them out keeps the factory deployable and lets either token type
 * change independently without touching the factory's state.
 *
 * Deployment is CREATE2 so an address can be mined before it exists. DEVOXPAD
 * uses that to give every launch an address ending in 8888: a recognisable mark
 * that says the token came from this launchpad and not from a lookalike. The
 * salt is found off-chain and passed in; the chain only checks the result.
 *
 * Each deployer renounces the admin role it inherits as the deploying account
 * in the same transaction, so it never retains power over a token it made.
 */
contract PrivateTokenDeployer {
    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external returns (address token) {
        DevoxToken t = new DevoxToken{salt: salt}(name, symbol, metadataURI, creator, minter);
        t.renounceRole(0x00, address(this)); // DEFAULT_ADMIN_ROLE
        token = address(t);
    }

    /**
     * The init code hash for a given set of constructor arguments.
     *
     * Handed to the client so it can mine a salt locally with the standard
     * CREATE2 formula, without shipping the contract's creation code to the
     * browser.
     */
    function initCodeHash(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    type(DevoxToken).creationCode,
                    abi.encode(name, symbol, metadataURI, creator, minter)
                )
            );
    }
}

contract PublicTokenDeployer {
    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external returns (address token) {
        DevoxPublicToken t = new DevoxPublicToken{salt: salt}(
            name,
            symbol,
            metadataURI,
            creator,
            minter
        );
        t.renounceRole(0x00, address(this));
        token = address(t);
    }

    function initCodeHash(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    type(DevoxPublicToken).creationCode,
                    abi.encode(name, symbol, metadataURI, creator, minter)
                )
            );
    }
}

interface ITokenDeployer {
    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external returns (address token);

    function initCodeHash(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address minter
    ) external view returns (bytes32);
}
