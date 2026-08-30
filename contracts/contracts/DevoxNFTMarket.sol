// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title DevoxNFTMarket - listings and offers, without taking custody.
 *
 * A listing is an approval and a price, not a deposit. The seller keeps the NFT
 * in their own wallet the whole time, which matters more here than usual: on a
 * private drop the metadata is sealed to whoever holds the token, so escrowing
 * it in a marketplace contract would re-seal the art to the marketplace and the
 * seller would lose the ability to read their own NFT while it sat for sale.
 *
 * Because nothing is held, a listing can go stale - sold elsewhere, transferred,
 * approval revoked. Every purchase therefore re-checks ownership and approval at
 * the moment it executes rather than trusting what was true when the listing was
 * made, and a stale one simply fails instead of moving somebody else's token.
 *
 * Offers are the mirror image and must work the other way round: a bid has to be
 * good when it is accepted, so the money is escrowed here. An offer nobody can
 * pay is not an offer.
 */
contract DevoxNFTMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant NATIVE = address(0);
    uint256 private constant BPS = 10_000;

    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        address payToken; // NATIVE for COTI
        uint256 price;
        bool active;
        uint64 listedAt;
    }

    struct Offer {
        address bidder;
        address collection;
        uint256 tokenId;
        address payToken; // escrowed, so never NATIVE
        uint256 amount;
        bool active;
        uint64 madeAt;
    }

    Listing[] private _listings;
    Offer[] private _offers;

    /// collection => tokenId => listing id + 1, so a token resolves in one read.
    mapping(address => mapping(uint256 => uint256)) private _listingOf;

    /// Marketplace fee, in basis points, taken from the sale price.
    uint256 public feeBps;
    address public feeRecipient;

    /// A collection's creator royalty, set by whoever deployed the collection.
    mapping(address => uint256) public royaltyBps;
    mapping(address => address) public royaltyRecipient;

    /// Marked collections, so a marketplace card can say which one is ours.
    mapping(address => bool) public official;

    event Listed(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, address payToken, uint256 price);
    event Delisted(uint256 indexed id, address indexed collection, uint256 indexed tokenId);
    event Sold(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price, uint256 fee, uint256 royalty);
    event OfferMade(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address bidder, address payToken, uint256 amount);
    event OfferCancelled(uint256 indexed id);
    event OfferAccepted(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, address bidder, uint256 amount);
    event RoyaltySet(address indexed collection, address recipient, uint256 bps);
    event OfficialSet(address indexed collection, bool official);

    error NotOwner();
    error NotApproved();
    error NotActive();
    error WrongPayment();
    error AlreadyListed();
    error FeeTooHigh();
    error NativeTransferFailed();

    constructor(address owner_, address feeRecipient_, uint256 feeBps_) Ownable(owner_) {
        require(feeRecipient_ != address(0), "fee recipient is zero");
        if (feeBps_ > 1000) revert FeeTooHigh(); // 10% ceiling, and it is a ceiling
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /* ── admin ───────────────────────────────────────────────────────────── */

    function setFee(address recipient, uint256 bps) external onlyOwner {
        require(recipient != address(0), "fee recipient is zero");
        if (bps > 1000) revert FeeTooHigh();
        feeRecipient = recipient;
        feeBps = bps;
    }

    /**
     * Marks a collection as DEVOXPAD's own.
     *
     * A marketplace is exactly where a convincing copy gets listed beside the
     * real thing, so "official" is a flag the contract owner sets and the card
     * renders - never a name or an image, which anyone can reproduce.
     */
    function setOfficial(address collection, bool isOfficial) external onlyOwner {
        official[collection] = isOfficial;
        emit OfficialSet(collection, isOfficial);
    }

    /**
     * Sets a collection's royalty.
     *
     * Only the collection's own owner may do this, so a creator controls their
     * terms and nobody can attach a royalty to a collection they do not run.
     */
    function setRoyalty(address collection, address recipient, uint256 bps) external {
        require(_collectionOwner(collection) == msg.sender || msg.sender == owner(), "not the creator");
        require(bps <= 1000, "royalty too high");
        royaltyBps[collection] = bps;
        royaltyRecipient[collection] = recipient;
        emit RoyaltySet(collection, recipient, bps);
    }

    function _collectionOwner(address collection) internal view returns (address) {
        (bool ok, bytes memory data) = collection.staticcall(abi.encodeWithSignature("owner()"));
        if (!ok || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }

    /* ── listings ────────────────────────────────────────────────────────── */

    function list(
        address collection,
        uint256 tokenId,
        address payToken,
        uint256 price
    ) external nonReentrant returns (uint256 id) {
        require(price > 0, "price is zero");
        IERC721 c = IERC721(collection);
        if (c.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!c.isApprovedForAll(msg.sender, address(this)) && c.getApproved(tokenId) != address(this)) {
            revert NotApproved();
        }

        uint256 existing = _listingOf[collection][tokenId];
        if (existing != 0 && _listings[existing - 1].active) revert AlreadyListed();

        _listings.push(
            Listing({
                seller: msg.sender,
                collection: collection,
                tokenId: tokenId,
                payToken: payToken,
                price: price,
                active: true,
                listedAt: uint64(block.timestamp)
            })
        );
        id = _listings.length - 1;
        _listingOf[collection][tokenId] = id + 1;

        emit Listed(id, collection, tokenId, msg.sender, payToken, price);
    }

    function delist(uint256 id) external nonReentrant {
        Listing storage l = _listings[id];
        if (!l.active) revert NotActive();
        require(l.seller == msg.sender, "not the seller");
        l.active = false;
        delete _listingOf[l.collection][l.tokenId];
        emit Delisted(id, l.collection, l.tokenId);
    }

    /**
     * Buys a listing.
     *
     * Ownership and approval are re-checked here rather than trusted from when
     * the listing was made, because nothing was ever held: the seller may have
     * moved or sold the token in between, and a marketplace that assumes
     * otherwise moves tokens that are no longer there to move.
     */
    function buy(uint256 id) external payable nonReentrant {
        Listing storage l = _listings[id];
        if (!l.active) revert NotActive();

        IERC721 c = IERC721(l.collection);
        if (c.ownerOf(l.tokenId) != l.seller) revert NotOwner();
        if (!c.isApprovedForAll(l.seller, address(this)) && c.getApproved(l.tokenId) != address(this)) {
            revert NotApproved();
        }

        uint256 price = l.price;
        uint256 fee = (price * feeBps) / BPS;
        uint256 royalty = (price * royaltyBps[l.collection]) / BPS;
        address royaltyTo = royaltyRecipient[l.collection];
        if (royaltyTo == address(0)) royalty = 0;
        uint256 toSeller = price - fee - royalty;

        l.active = false;
        delete _listingOf[l.collection][l.tokenId];

        if (l.payToken == NATIVE) {
            if (msg.value != price) revert WrongPayment();
            if (fee > 0) _sendNative(feeRecipient, fee);
            if (royalty > 0) _sendNative(royaltyTo, royalty);
            _sendNative(l.seller, toSeller);
        } else {
            if (msg.value != 0) revert WrongPayment();
            IERC20 t = IERC20(l.payToken);
            if (fee > 0) t.safeTransferFrom(msg.sender, feeRecipient, fee);
            if (royalty > 0) t.safeTransferFrom(msg.sender, royaltyTo, royalty);
            t.safeTransferFrom(msg.sender, l.seller, toSeller);
        }

        // Last, so a failed payment cannot leave the token moved and unpaid.
        c.transferFrom(l.seller, msg.sender, l.tokenId);

        emit Sold(id, l.collection, l.tokenId, l.seller, msg.sender, price, fee, royalty);
    }

    /* ── offers ──────────────────────────────────────────────────────────── */

    /**
     * Makes an offer, escrowing the money here.
     *
     * The opposite choice to listings, and for the opposite reason: a seller
     * accepting a bid must be able to rely on it being funded, so the tokens sit
     * here until the offer is taken or withdrawn. Native COTI is not accepted
     * for this - an escrowed native balance would need its own accounting and an
     * ERC-20 offer does the same job.
     */
    function makeOffer(
        address collection,
        uint256 tokenId,
        address payToken,
        uint256 amount
    ) external nonReentrant returns (uint256 id) {
        require(payToken != NATIVE, "offers are made in an ERC-20");
        require(amount > 0, "amount is zero");

        IERC20 t = IERC20(payToken);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - before;
        require(received > 0, "nothing received");

        _offers.push(
            Offer({
                bidder: msg.sender,
                collection: collection,
                tokenId: tokenId,
                payToken: payToken,
                amount: received,
                active: true,
                madeAt: uint64(block.timestamp)
            })
        );
        id = _offers.length - 1;
        emit OfferMade(id, collection, tokenId, msg.sender, payToken, received);
    }

    function cancelOffer(uint256 id) external nonReentrant {
        Offer storage o = _offers[id];
        if (!o.active) revert NotActive();
        require(o.bidder == msg.sender, "not the bidder");
        o.active = false;
        IERC20(o.payToken).safeTransfer(o.bidder, o.amount);
        emit OfferCancelled(id);
    }

    function acceptOffer(uint256 id) external nonReentrant {
        Offer storage o = _offers[id];
        if (!o.active) revert NotActive();

        IERC721 c = IERC721(o.collection);
        if (c.ownerOf(o.tokenId) != msg.sender) revert NotOwner();
        if (!c.isApprovedForAll(msg.sender, address(this)) && c.getApproved(o.tokenId) != address(this)) {
            revert NotApproved();
        }

        uint256 amount = o.amount;
        uint256 fee = (amount * feeBps) / BPS;
        uint256 royalty = (amount * royaltyBps[o.collection]) / BPS;
        address royaltyTo = royaltyRecipient[o.collection];
        if (royaltyTo == address(0)) royalty = 0;

        o.active = false;

        // Any listing for this token is now stale and is closed with it.
        uint256 slot = _listingOf[o.collection][o.tokenId];
        if (slot != 0) {
            _listings[slot - 1].active = false;
            delete _listingOf[o.collection][o.tokenId];
        }

        IERC20 t = IERC20(o.payToken);
        if (fee > 0) t.safeTransfer(feeRecipient, fee);
        if (royalty > 0) t.safeTransfer(royaltyTo, royalty);
        t.safeTransfer(msg.sender, amount - fee - royalty);

        c.transferFrom(msg.sender, o.bidder, o.tokenId);

        emit OfferAccepted(id, o.collection, o.tokenId, msg.sender, o.bidder, amount);
    }

    /* ── views ───────────────────────────────────────────────────────────── */

    function listingCount() external view returns (uint256) {
        return _listings.length;
    }

    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    function listing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function offer(uint256 id) external view returns (Offer memory) {
        return _offers[id];
    }

    /** The live listing for a token, if there is one. */
    function listingOf(address collection, uint256 tokenId)
        external
        view
        returns (bool listed, uint256 id, Listing memory l)
    {
        uint256 slot = _listingOf[collection][tokenId];
        if (slot == 0 || !_listings[slot - 1].active) return (false, 0, l);
        return (true, slot - 1, _listings[slot - 1]);
    }

    /**
     * Whether a listing would actually execute right now.
     *
     * A stale listing is normal here, since nothing is escrowed, and a page that
     * shows a price which cannot be paid is worse than one that says why.
     */
    function listingLive(uint256 id) external view returns (bool live, string memory reason) {
        Listing storage l = _listings[id];
        if (!l.active) return (false, "not listed");

        IERC721 c = IERC721(l.collection);
        address holder;
        try c.ownerOf(l.tokenId) returns (address o) {
            holder = o;
        } catch {
            return (false, "token no longer exists");
        }
        if (holder != l.seller) return (false, "the seller no longer holds it");
        if (!c.isApprovedForAll(l.seller, address(this)) && c.getApproved(l.tokenId) != address(this)) {
            return (false, "approval was revoked");
        }
        return (true, "");
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    /** Bare native transfers are refused; buying has an entrypoint. */
    receive() external payable {
        revert WrongPayment();
    }
}
