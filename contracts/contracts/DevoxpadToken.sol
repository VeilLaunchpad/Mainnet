// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DEVOXPAD - the protocol token.
 *
 * Every token the launchpad makes is minted by a bonding curve that can keep
 * minting. This one is the opposite and deliberately so: the entire supply is
 * created in the constructor and there is no mint function afterwards, no
 * minter role, and no owner. Nothing in this contract can raise the supply,
 * which is a property anyone can check by reading it rather than a promise.
 *
 * `ERC20Burnable` is the only direction supply can move, and only a holder can
 * burn their own. There is deliberately no `ERC20Permit`: OpenZeppelin's
 * implementation reaches EIP-712 code that compiles to `mcopy`, a Cancun
 * instruction, and COTI's gcVM targets Paris. Approvals are a transaction here
 * rather than a signature, which is the honest trade for a chain that cannot
 * run the alternative.
 *
 * It is a public ERC20, not a PrivateERC20, and that is the right shape for it:
 * staking has to read a balance to compute a reward, and a ciphertext balance
 * cannot be read by a contract. Privacy comes from wrapping it through
 * DevoxPortal, which locks the public token and mints p.DEVOXPAD one to one - the
 * private twin is fully backed and the escrow behind it stays publicly
 * auditable.
 */
contract DevoxpadToken is ERC20, ERC20Burnable {
    /// Points at the token's metadata, the same convention every launch uses.
    string public metadataURI;

    /// The whole supply, fixed at deployment and unable to grow.
    uint256 public immutable initialSupply;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        address recipient,
        uint256 supply
    ) ERC20(name_, symbol_) {
        require(recipient != address(0), "recipient is zero");
        require(supply > 0, "supply is zero");

        metadataURI = metadataURI_;
        initialSupply = supply;
        _mint(recipient, supply);
    }
}

/**
 * @title DevoxpadTokenDeployer - CREATE2, so the address can be chosen.
 *
 * DEVOXPAD marks every token it launches with an address ending in 8888, and the
 * protocol token is not going to be the exception. CREATE2 makes the address a
 * function of the salt, so a salt is mined off chain until the resulting
 * address ends the right way, and the chain only has to check the result.
 *
 * The deployer holds no role over what it makes. DevoxpadToken has no owner and
 * no minter, so unlike the launch deployers there is nothing here to renounce.
 *
 * `deploy` is owner-only, which is not about the address itself - CREATE2 binds
 * that to the salt and the constructor arguments, so nobody can take a mined
 * address by racing to it with different arguments. It is about provenance.
 * Left open, anyone could mint a token through this same contract carrying
 * every signal the project asks people to trust: the same deployer, the same
 * name, an 8888 address. Closing it means "came from here" stays a real claim.
 */
contract DevoxpadTokenDeployer is Ownable {
    constructor() Ownable(msg.sender) {}

    event Deployed(address indexed token, bytes32 salt, address recipient, uint256 supply);

    function deploy(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address recipient,
        uint256 supply
    ) external onlyOwner returns (address token) {
        DevoxpadToken t = new DevoxpadToken{salt: salt}(name, symbol, metadataURI, recipient, supply);
        token = address(t);
        emit Deployed(token, salt, recipient, supply);
    }

    /**
     * The init code hash for one exact set of constructor arguments.
     *
     * Handed to the client so it can mine a salt with the standard CREATE2
     * formula locally, without the creation code ever crossing the wire. Change
     * any argument and the hash changes, which is why the mined salt is only
     * valid for the arguments it was mined against.
     */
    function initCodeHash(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address recipient,
        uint256 supply
    ) external pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    type(DevoxpadToken).creationCode,
                    abi.encode(name, symbol, metadataURI, recipient, supply)
                )
            );
    }

    /** The address a given salt would produce, so a caller can check before sending. */
    function predict(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address recipient,
        uint256 supply
    ) external view returns (address) {
        bytes32 h = keccak256(
            abi.encodePacked(
                type(DevoxpadToken).creationCode,
                abi.encode(name, symbol, metadataURI, recipient, supply)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }
}
