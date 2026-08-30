// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateERC721} from "@coti-io/coti-contracts/contracts/token/PrivateERC721/PrivateERC721.sol";
import {PrivateERC721URIStorage} from "@coti-io/coti-contracts/contracts/token/PrivateERC721/extensions/PrivateERC721URIStorage.sol";
import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * Everything a drop is configured with, as one struct.
 *
 * Passed as a struct rather than ten arguments because the factory has to ABI-
 * encode this to compute a CREATE2 address, and ten loose values exhaust the
 * stack even through the IR pipeline. Grouping them is what makes the whole
 * mine-the-address flow compile at all.
 */
struct DropConfig {
    string name;
    string symbol;
    string previewURI;
    uint256 maxSupply;
    uint256 mintPrice;
    address payToken;
    uint256 maxPerWallet;
    uint64 presaleStart;
    uint64 publicStart;
    address owner;
}

/**
 * @title DevoxNFTDrop - a scheduled drop whose metadata only the owner can read.
 *
 * "Reveal after mint" on every other chain is a promise: the art sits on a
 * server behind a flag somebody can flip early, and you are trusting them not
 * to. Here it is arithmetic. The private metadata is a network ciphertext, and
 * `PrivateERC721URIStorage` re-seals it to whoever currently holds the token on
 * every transfer. Nobody who does not own it can decrypt it - not the creator,
 * not this contract, not an indexer.
 *
 * Two URIs, deliberately:
 *
 *   previewURI  public, and the marketplace needs it. A card with nothing on it
 *               is not a listing, so the image, name and traits stay readable.
 *   secret      encrypted, sealed per owner. Whatever the creator wants only a
 *               holder to see - the unrevealed art, a key, an unlock code.
 *
 * Supply is fixed at construction because a drop that can grow is not a drop,
 * and a mint price of zero is a first-class case rather than an edge one.
 */
contract DevoxNFTDrop is PrivateERC721URIStorage, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Native COTI is spelled as the zero address, as everywhere else here.
    address public constant NATIVE = address(0);

    /// Fixed at construction. Nothing can raise it.
    uint256 public immutable maxSupply;

    /// What one mint costs. Zero is a free mint, which is a real configuration.
    uint256 public mintPrice;

    /// The asset the price is paid in. `NATIVE` for COTI.
    address public immutable payToken;

    /// Where the proceeds go. Set once, by the creator.
    address public proceeds;

    /// Most one address may mint. Zero means no limit.
    uint256 public maxPerWallet;

    /// Public minting opens at this timestamp. Zero means open now.
    uint64 public publicStart;

    /// Allowlisted addresses may mint from here. Zero disables the presale.
    uint64 public presaleStart;

    /// Public preview, readable by anyone. The marketplace renders this.
    string public previewURI;

    /**
     * The private metadata, held as a network ciphertext.
     *
     * Stored once by the creator and re-sealed to each minter, rather than
     * encrypted per token by hand: a ten-thousand-piece collection would
     * otherwise need ten thousand signed inputs before it could open.
     */
    ctString private _secret;
    bool public secretSet;

    uint256 public totalMinted;

    mapping(address => bool) public allowlisted;
    mapping(address => uint256) public mintedBy;

    event Minted(address indexed to, uint256 indexed tokenId, uint256 paid);
    event SecretSet(address indexed by);
    event PhasesSet(uint64 presaleStart, uint64 publicStart);
    event PriceSet(uint256 mintPrice, uint256 maxPerWallet);
    event Allowlisted(address indexed who, bool allowed);

    error SoldOut();
    error NotOpenYet();
    error NotAllowlisted();
    error WrongPayment();
    error PerWalletCap();
    error SecretMissing();
    error NativeTransferFailed();

    constructor(DropConfig memory cfg)
        PrivateERC721(cfg.name, cfg.symbol)
        Ownable(cfg.owner)
    {
        require(cfg.maxSupply > 0, "supply is zero");
        maxSupply = cfg.maxSupply;
        mintPrice = cfg.mintPrice;
        payToken = cfg.payToken;
        maxPerWallet = cfg.maxPerWallet;
        presaleStart = cfg.presaleStart;
        publicStart = cfg.publicStart;
        previewURI = cfg.previewURI;
        proceeds = cfg.owner;
    }

    /* ── the creator's side ──────────────────────────────────────────────── */

    /**
     * Seeds the private metadata, once.
     *
     * The creator signs it with their own key, the MPC network validates it,
     * and what lands in storage is a network ciphertext the contract can seal
     * to a minter without ever holding the plaintext itself.
     */
    function setSecret(itString calldata itSecret) external onlyOwner {
        gtString memory gt = MpcCore.validateCiphertext(itSecret);
        // Sealed to this contract so it can be re-sealed to each minter later.
        _secret = MpcCore.offBoardCombined(gt, address(this)).ciphertext;
        secretSet = true;
        emit SecretSet(msg.sender);
    }

    function setPreviewURI(string calldata uri) external onlyOwner {
        previewURI = uri;
    }

    function setPhases(uint64 presaleStart_, uint64 publicStart_) external onlyOwner {
        presaleStart = presaleStart_;
        publicStart = publicStart_;
        emit PhasesSet(presaleStart_, publicStart_);
    }

    function setPrice(uint256 mintPrice_, uint256 maxPerWallet_) external onlyOwner {
        mintPrice = mintPrice_;
        maxPerWallet = maxPerWallet_;
        emit PriceSet(mintPrice_, maxPerWallet_);
    }

    function setProceeds(address to) external onlyOwner {
        require(to != address(0), "proceeds is zero");
        proceeds = to;
    }

    function setAllowlist(address[] calldata who, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < who.length; i++) {
            allowlisted[who[i]] = allowed;
            emit Allowlisted(who[i], allowed);
        }
    }

    /* ── minting ─────────────────────────────────────────────────────────── */

    /** Whether this address can mint right now, and why not if it cannot. */
    function mintState(address who) public view returns (bool open, string memory reason) {
        if (totalMinted >= maxSupply) return (false, "sold out");
        if (!secretSet) return (false, "the creator has not set the private metadata yet");

        bool publicOpen = publicStart == 0 || block.timestamp >= publicStart;
        bool presaleOpen = presaleStart != 0 && block.timestamp >= presaleStart && allowlisted[who];

        if (!publicOpen && !presaleOpen) return (false, "not open yet");
        if (maxPerWallet != 0 && mintedBy[who] >= maxPerWallet) return (false, "per-wallet limit reached");
        return (true, "");
    }

    function mint(uint256 quantity) external payable nonReentrant {
        if (quantity == 0) revert WrongPayment();
        if (totalMinted + quantity > maxSupply) revert SoldOut();
        if (!secretSet) revert SecretMissing();

        bool publicOpen = publicStart == 0 || block.timestamp >= publicStart;
        bool presaleOpen = presaleStart != 0 && block.timestamp >= presaleStart && allowlisted[msg.sender];
        if (!publicOpen && !presaleOpen) {
            revert(allowlisted[msg.sender] || presaleStart == 0 ? "not open yet" : "not allowlisted yet");
        }

        if (maxPerWallet != 0 && mintedBy[msg.sender] + quantity > maxPerWallet) revert PerWalletCap();

        uint256 due = mintPrice * quantity;
        if (payToken == NATIVE) {
            if (msg.value != due) revert WrongPayment();
            if (due > 0) _sendNative(proceeds, due);
        } else {
            if (msg.value != 0) revert WrongPayment();
            if (due > 0) IERC20(payToken).safeTransferFrom(msg.sender, proceeds, due);
        }

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalMinted + i + 1; // ids start at 1, so 0 stays "none"
            _mint(msg.sender, tokenId);
            // Re-sealed from the stored network ciphertext, so the minter - and
            // only the minter - can read it.
            PrivateERC721URIStorage._setTokenURI(msg.sender, tokenId, _secret);
            emit Minted(msg.sender, tokenId, mintPrice);
        }

        totalMinted += quantity;
        mintedBy[msg.sender] += quantity;
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    /**
     * Bare native transfers are refused.
     *
     * Minting has an entrypoint that accounts for what it receives. Anything
     * arriving outside it would sit here unowned, and a contract holding money
     * nobody can claim is worse than one that says no.
     */
    receive() external payable {
        revert WrongPayment();
    }
}
