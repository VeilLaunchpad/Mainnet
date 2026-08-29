// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4);
}

struct EditionsConfig {
    string name;
    string symbol;
    string previewURI;
    address owner;
}

/**
 * @title VeilNFTEditions - an open collection whose editions stay private per holder.
 *
 * The other half of the studio. A scheduled drop is one fixed run of unique
 * tokens; an open collection is a set of editions a creator keeps adding to,
 * each mintable by many people at once. Think a print shop rather than a
 * gallery opening.
 *
 * Written from scratch rather than on OpenZeppelin's ERC-1155 because that
 * contract emits `mcopy`, a Cancun opcode, and COTI's gcVM is Paris. The same
 * wall the ERC-721 side hit. What is here is the ERC-1155 interface proper -
 * balances, batch transfers, operator approval, receiver hooks - and nothing
 * beyond it.
 *
 * The privacy is the interesting part, and it is not the ERC-721 model.
 *
 * A unique token has exactly one owner, so COTI seals its metadata to that one
 * address and re-seals on transfer. An edition has hundreds of holders at once,
 * so there is no single address to seal to. Instead each edition keeps one
 * network ciphertext - readable by nobody, including this contract - and every
 * holder gets their own copy of it sealed to their own key the first time a
 * copy reaches them. Two hundred holders means two hundred ciphertexts of the
 * same secret, each one useless to the other hundred and ninety-nine.
 *
 * The seal is granted on receipt and deliberately never revoked when a holder's
 * balance falls to zero. Revoking would be theatre: they have already read it,
 * and a chain cannot un-tell somebody something. What it would do is punish the
 * honest case where somebody sells one of three copies. Access is recorded as
 * "has held this edition", which is what it honestly is.
 */
contract VeilNFTEditions is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant NATIVE = address(0);

    struct Edition {
        uint256 maxSupply; // 0 means open-ended, which is the point of the format
        uint256 minted;
        uint256 price;
        address payToken;
        uint256 maxPerWallet;
        uint64 opensAt;
        uint64 closesAt; // 0 means it never closes
        string previewURI;
        bool exists;
    }

    string public name;
    string public symbol;
    /// Collection-level public art. An edition may override it with its own.
    string public previewURI;
    address public proceeds;

    uint256 public editionCount;
    mapping(uint256 => Edition) public editions;

    mapping(uint256 => mapping(address => uint256)) private _balances;
    mapping(address => mapping(address => bool)) private _operatorApproval;
    mapping(uint256 => mapping(address => uint256)) public mintedBy;

    /// Per edition: the secret, sealed to the network. Not readable by anyone.
    mapping(uint256 => ctString) private _secret;
    mapping(uint256 => bool) public secretSet;

    /// Per edition, per holder: that same secret, sealed to their key alone.
    mapping(uint256 => mapping(address => ctString)) private _sealed;
    mapping(uint256 => mapping(address => bool)) public unlocked;

    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value
    );
    event TransferBatch(
        address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);

    event EditionCreated(uint256 indexed id, uint256 maxSupply, uint256 price, address payToken);
    event EditionMinted(uint256 indexed id, address indexed to, uint256 quantity, uint256 paid);
    event SecretSealed(uint256 indexed id, address indexed holder);

    error NoSuchEdition();
    error SoldOut();
    error NotOpenYet();
    error Closed();
    error WrongPayment();
    error PerWalletCap();
    error SecretMissing();
    error NotOwnerNorApproved();
    error InsufficientBalance();
    error LengthMismatch();
    error TransferToZero();
    error NativeTransferFailed();
    error ReceiverRejected();

    constructor(EditionsConfig memory cfg) Ownable(cfg.owner) {
        name = cfg.name;
        symbol = cfg.symbol;
        previewURI = cfg.previewURI;
        proceeds = cfg.owner;
    }

    /* ── the creator's side ──────────────────────────────────────────────── */

    /**
     * Opens an edition.
     *
     * The secret arrives already encrypted under the creator's key: it is
     * validated by the MPC network and stored sealed to this contract, so what
     * sits in storage is a ciphertext this contract can re-seal to a holder
     * without ever being able to read.
     */
    function createEdition(
        uint256 maxSupply_,
        uint256 price_,
        address payToken_,
        uint256 maxPerWallet_,
        uint64 opensAt_,
        uint64 closesAt_,
        string calldata previewURI_,
        itString calldata itSecret
    ) external onlyOwner returns (uint256 id) {
        require(closesAt_ == 0 || closesAt_ > opensAt_, "closes before it opens");

        id = ++editionCount;
        editions[id] = Edition({
            maxSupply: maxSupply_,
            minted: 0,
            price: price_,
            payToken: payToken_,
            maxPerWallet: maxPerWallet_,
            opensAt: opensAt_,
            closesAt: closesAt_,
            previewURI: previewURI_,
            exists: true
        });

        gtString memory gt = MpcCore.validateCiphertext(itSecret);
        _secret[id] = MpcCore.offBoardCombined(gt, address(this)).ciphertext;
        secretSet[id] = true;

        emit EditionCreated(id, maxSupply_, price_, payToken_);
        emit URI(previewURI_, id);
    }

    function setEditionSecret(uint256 id, itString calldata itSecret) external onlyOwner {
        if (!editions[id].exists) revert NoSuchEdition();
        gtString memory gt = MpcCore.validateCiphertext(itSecret);
        _secret[id] = MpcCore.offBoardCombined(gt, address(this)).ciphertext;
        secretSet[id] = true;
    }

    function setEditionWindow(uint256 id, uint64 opensAt_, uint64 closesAt_) external onlyOwner {
        if (!editions[id].exists) revert NoSuchEdition();
        require(closesAt_ == 0 || closesAt_ > opensAt_, "closes before it opens");
        editions[id].opensAt = opensAt_;
        editions[id].closesAt = closesAt_;
    }

    function setEditionPrice(uint256 id, uint256 price_, uint256 maxPerWallet_) external onlyOwner {
        if (!editions[id].exists) revert NoSuchEdition();
        editions[id].price = price_;
        editions[id].maxPerWallet = maxPerWallet_;
    }

    function setPreviewURI(string calldata uri_) external onlyOwner {
        previewURI = uri_;
    }

    function setProceeds(address to) external onlyOwner {
        require(to != address(0), "proceeds is zero");
        proceeds = to;
    }

    /* ── minting ─────────────────────────────────────────────────────────── */

    /** Whether this address can mint this edition now, and why not if it cannot. */
    function mintState(uint256 id, address who) public view returns (bool open, string memory reason) {
        Edition storage e = editions[id];
        if (!e.exists) return (false, "no such edition");
        if (!secretSet[id]) return (false, "the creator has not set the private metadata yet");
        if (e.maxSupply != 0 && e.minted >= e.maxSupply) return (false, "sold out");
        if (e.opensAt != 0 && block.timestamp < e.opensAt) return (false, "not open yet");
        if (e.closesAt != 0 && block.timestamp >= e.closesAt) return (false, "closed");
        if (e.maxPerWallet != 0 && mintedBy[id][who] >= e.maxPerWallet) return (false, "per-wallet limit reached");
        return (true, "");
    }

    function mint(uint256 id, uint256 quantity) external payable nonReentrant {
        Edition storage e = editions[id];
        if (!e.exists) revert NoSuchEdition();
        if (!secretSet[id]) revert SecretMissing();
        if (quantity == 0) revert WrongPayment();
        if (e.maxSupply != 0 && e.minted + quantity > e.maxSupply) revert SoldOut();
        if (e.opensAt != 0 && block.timestamp < e.opensAt) revert NotOpenYet();
        if (e.closesAt != 0 && block.timestamp >= e.closesAt) revert Closed();
        if (e.maxPerWallet != 0 && mintedBy[id][msg.sender] + quantity > e.maxPerWallet) revert PerWalletCap();

        uint256 due = e.price * quantity;
        if (e.payToken == NATIVE) {
            if (msg.value != due) revert WrongPayment();
            if (due > 0) _sendNative(proceeds, due);
        } else {
            if (msg.value != 0) revert WrongPayment();
            if (due > 0) IERC20(e.payToken).safeTransferFrom(msg.sender, proceeds, due);
        }

        e.minted += quantity;
        mintedBy[id][msg.sender] += quantity;
        _balances[id][msg.sender] += quantity;

        _grant(id, msg.sender);

        emit TransferSingle(msg.sender, address(0), msg.sender, id, quantity);
        emit EditionMinted(id, msg.sender, quantity, due);
    }

    /**
     * Seals this edition's secret to one holder's key.
     *
     * Costs a real MPC round trip, so it runs once per holder and is skipped
     * for anyone who already has their copy.
     */
    function _grant(uint256 id, address to) internal {
        if (unlocked[id][to] || to == address(0)) return;
        gtString memory gt = MpcCore.onBoard(_secret[id]);
        _sealed[id][to] = MpcCore.offBoardCombined(gt, to).userCiphertext;
        unlocked[id][to] = true;
        emit SecretSealed(id, to);
    }

    /**
     * The private metadata, as sealed to one holder.
     *
     * Anyone may call this for anyone; it is only ever useful to the holder,
     * because the ciphertext is bound to their key. That is the whole design -
     * access is decided by cryptography, not by this function refusing to
     * answer.
     */
    function secretOf(uint256 id, address holder) external view returns (ctString memory) {
        return _sealed[id][holder];
    }

    /** The public art. Per-edition if it has its own, otherwise the collection's. */
    function uri(uint256 id) external view returns (string memory) {
        string memory own = editions[id].previewURI;
        return bytes(own).length > 0 ? own : previewURI;
    }

    /* ── the ERC-1155 surface ────────────────────────────────────────────── */

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory out)
    {
        if (accounts.length != ids.length) revert LengthMismatch();
        out = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) out[i] = _balances[ids[i]][accounts[i]];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApproval[account][operator];
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data)
        external
        nonReentrant
    {
        if (from != msg.sender && !isApprovedForAll(from, msg.sender)) revert NotOwnerNorApproved();
        _move(from, to, id, value);
        emit TransferSingle(msg.sender, from, to, id, value);
        _checkReceived(msg.sender, from, to, id, value, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external nonReentrant {
        if (from != msg.sender && !isApprovedForAll(from, msg.sender)) revert NotOwnerNorApproved();
        if (ids.length != values.length) revert LengthMismatch();
        for (uint256 i = 0; i < ids.length; i++) _move(from, to, ids[i], values[i]);
        emit TransferBatch(msg.sender, from, to, ids, values);
        _checkBatchReceived(msg.sender, from, to, ids, values, data);
    }

    /** Moves balance and seals the secret to the recipient if it is new to them. */
    function _move(address from, address to, uint256 id, uint256 value) internal {
        if (to == address(0)) revert TransferToZero();
        uint256 held = _balances[id][from];
        if (held < value) revert InsufficientBalance();
        unchecked {
            _balances[id][from] = held - value;
        }
        _balances[id][to] += value;
        _grant(id, to);
    }

    function _checkReceived(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) private {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155Received(operator, from, id, value, data) returns (bytes4 got) {
            if (got != IERC1155Receiver.onERC1155Received.selector) revert ReceiverRejected();
        } catch {
            revert ReceiverRejected();
        }
    }

    function _checkBatchReceived(
        address operator,
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) private {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, values, data) returns (bytes4 got) {
            if (got != IERC1155Receiver.onERC1155BatchReceived.selector) revert ReceiverRejected();
        } catch {
            revert ReceiverRejected();
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0xd9b67a26 // ERC1155
            || interfaceId == 0x0e89341c; // ERC1155MetadataURI
    }

    function _sendNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    /** As with the drop: money arriving outside `mint` would belong to nobody. */
    receive() external payable {
        revert WrongPayment();
    }
}
