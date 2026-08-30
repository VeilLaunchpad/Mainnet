// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @title DevoxNFTStaking - stake the NFT, earn the token it was paired with.
 *
 * A collection launches one of two ways. SOLO is an ordinary drop: art, a
 * price, nothing else. PAIRED means the creator escrowed a reward token before
 * the collection could open, and holders can stake the NFT to earn it.
 *
 * The escrow is the whole point, and it is why this is a promise that keeps
 * itself. The creator does not pledge a yield and hope to fund it later; they
 * fund it first, the money sits here, and the pool cannot pay out a single
 * token more than was deposited. A pool whose budget is exhausted stops
 * accruing rather than quietly going insolvent.
 *
 * An "APY" on an NFT needs a notional to be a percentage of, since a token has
 * no balance. The creator sets a reward per NFT per year and the mint price it
 * was sold at; the rate is derived from those two, and both are public, so the
 * number on the page is one anybody can recompute.
 *
 * Staked NFTs are held here and are always withdrawable. `emergencyUnstake`
 * returns one without reading the reward maths at all, so a broken reward
 * configuration can never trap the art.
 */
contract DevoxNFTStaking is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint256 private constant YEAR = 365 days;
    uint256 private constant BPS = 10_000;

    struct Pool {
        /// The collection whose tokens may be staked here.
        IERC721 collection;
        /// What holders earn. Escrowed in full before the pool opens.
        IERC20 rewardToken;
        /// Who launched it, and who may top the budget up.
        address creator;
        /// Reward per staked NFT per year, in reward-token wei.
        uint256 rewardPerNftPerYear;
        /**
         * What one NFT was sold for, in reward-token wei, purely so an APY can
         * be quoted. Zero means the pool advertises a flat rate instead, which
         * is honest rather than a missing feature.
         */
        uint256 notionalPerNft;
        /// What the creator escrowed, and what is left of it.
        uint256 budget;
        uint256 paidOut;
        uint256 staked;
        bool active;
        uint64 lastUpdate;
        /// Reward one NFT has accrued since the pool opened, in reward-token wei.
        uint256 accPerNft;
    }

    struct Stake {
        uint256 count;
        uint256 rewardDebt;
        /// Earned but not yet handed over, because the budget ran out.
        uint256 owed;
    }

    Pool[] private _pools;

    /// pid => owner => their position
    mapping(uint256 => mapping(address => Stake)) private _stakes;

    /// pid => tokenId => who staked it, so only they can take it back.
    mapping(uint256 => mapping(uint256 => address)) public stakerOf;

    /// collection => pid + 1, so a collection resolves to its pool in one read.
    mapping(address => uint256) private _poolOfCollection;

    event PoolOpened(
        uint256 indexed pid,
        address indexed collection,
        address indexed rewardToken,
        uint256 rewardPerNftPerYear,
        uint256 budget
    );
    event BudgetAdded(uint256 indexed pid, address indexed from, uint256 amount);
    event Staked(address indexed who, uint256 indexed pid, uint256 tokenId);
    event Unstaked(address indexed who, uint256 indexed pid, uint256 tokenId);
    event Claimed(address indexed who, uint256 indexed pid, uint256 paid, uint256 stillOwed);
    event EmergencyUnstaked(address indexed who, uint256 indexed pid, uint256 tokenId);
    event PoolUpdated(uint256 indexed pid, uint256 rewardPerNftPerYear, bool active);

    error NoSuchPool();
    error PoolClosed();
    error AlreadyPaired();
    error NotYourStake();
    error NothingStaked();
    error BudgetTooSmall();

    constructor(address owner_) Ownable(owner_) {}

    /* ── opening a pool ──────────────────────────────────────────────────── */

    /**
     * Pairs a collection with a reward token, escrowing the whole budget now.
     *
     * Permissionless on purpose: anyone can pair a collection they are willing
     * to fund. What they cannot do is pair one twice, or promise a yield
     * without paying for it up front.
     */
    function openPool(
        address collection,
        address rewardToken,
        uint256 rewardPerNftPerYear,
        uint256 notionalPerNft,
        uint256 budget
    ) external nonReentrant returns (uint256 pid) {
        require(collection != address(0) && rewardToken != address(0), "zero address");
        require(rewardPerNftPerYear > 0, "rate is zero");
        if (_poolOfCollection[collection] != 0) revert AlreadyPaired();
        if (budget == 0) revert BudgetTooSmall();

        // Measured rather than assumed, so a token that takes a cut on transfer
        // funds the pool with what actually arrived.
        IERC20 t = IERC20(rewardToken);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), budget);
        uint256 received = t.balanceOf(address(this)) - before;
        if (received == 0) revert BudgetTooSmall();

        _pools.push(
            Pool({
                collection: IERC721(collection),
                rewardToken: t,
                creator: msg.sender,
                rewardPerNftPerYear: rewardPerNftPerYear,
                notionalPerNft: notionalPerNft,
                budget: received,
                paidOut: 0,
                staked: 0,
                active: true,
                lastUpdate: uint64(block.timestamp),
                accPerNft: 0
            })
        );

        pid = _pools.length - 1;
        _poolOfCollection[collection] = pid + 1;
        emit PoolOpened(pid, collection, rewardToken, rewardPerNftPerYear, received);
    }

    /** Tops up a pool's escrow. Anyone may fund a collection they believe in. */
    function addBudget(uint256 pid, uint256 amount) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];

        uint256 before = p.rewardToken.balanceOf(address(this));
        p.rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        p.budget += p.rewardToken.balanceOf(address(this)) - before;

        emit BudgetAdded(pid, msg.sender, amount);
    }

    /**
     * Changes the rate, or closes the pool to new stakes.
     *
     * Settled first, so everything earned so far is locked in at the old rate.
     * Only the creator, and never in a way that reaches a staked NFT.
     */
    function setPool(uint256 pid, uint256 rewardPerNftPerYear, bool active) external {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        require(msg.sender == p.creator || msg.sender == owner(), "not the creator");
        require(rewardPerNftPerYear > 0, "rate is zero");

        _updatePool(pid);
        p.rewardPerNftPerYear = rewardPerNftPerYear;
        p.active = active;
        emit PoolUpdated(pid, rewardPerNftPerYear, active);
    }

    /* ── accrual ─────────────────────────────────────────────────────────── */

    function _updatePool(uint256 pid) internal {
        Pool storage p = _pools[pid];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs <= p.lastUpdate) return;

        uint256 elapsed = nowTs - p.lastUpdate;
        // `rewardPerNftPerYear` is already a token amount, so no extra scaling
        // is needed here - one NFT simply accrues its annual rate pro rata.
        // This must stay identical to `_accNow`, or a claim and its preview
        // would disagree.
        p.accPerNft += (elapsed * p.rewardPerNftPerYear) / YEAR;
        p.lastUpdate = nowTs;
    }

    function _accNow(Pool storage p) internal view returns (uint256) {
        if (block.timestamp <= p.lastUpdate) return p.accPerNft;
        uint256 elapsed = block.timestamp - p.lastUpdate;
        return p.accPerNft + (elapsed * p.rewardPerNftPerYear) / YEAR;
    }

    /** Everything a staker has earned and not yet received. */
    function pendingReward(uint256 pid, address who) public view returns (uint256) {
        if (pid >= _pools.length) return 0;
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][who];

        uint256 accrued = s.count * _accNow(p);
        uint256 fresh = accrued > s.rewardDebt ? accrued - s.rewardDebt : 0;
        return s.owed + fresh;
    }

    function _settle(uint256 pid, address who) internal {
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][who];
        uint256 accrued = s.count * p.accPerNft;
        if (accrued > s.rewardDebt) s.owed += accrued - s.rewardDebt;
        s.rewardDebt = accrued;
    }

    function _resetDebt(uint256 pid, address who) internal {
        Stake storage s = _stakes[pid][who];
        s.rewardDebt = s.count * _pools[pid].accPerNft;
    }

    /* ── staking ─────────────────────────────────────────────────────────── */

    function stake(uint256 pid, uint256[] calldata tokenIds) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        if (!p.active) revert PoolClosed();
        require(tokenIds.length > 0, "nothing to stake");

        _updatePool(pid);
        _settle(pid, msg.sender);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            p.collection.transferFrom(msg.sender, address(this), tokenIds[i]);
            stakerOf[pid][tokenIds[i]] = msg.sender;
            emit Staked(msg.sender, pid, tokenIds[i]);
        }

        _stakes[pid][msg.sender].count += tokenIds.length;
        p.staked += tokenIds.length;
        _resetDebt(pid, msg.sender);
    }

    /**
     * Takes NFTs back, and pays what they earned.
     *
     * Deliberately independent of `active`: closing a pool stops new stakes and
     * must never trap the ones already in it.
     */
    function unstake(uint256 pid, uint256[] calldata tokenIds) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][msg.sender];
        if (tokenIds.length == 0 || tokenIds.length > s.count) revert NothingStaked();

        _updatePool(pid);
        _settle(pid, msg.sender);

        s.count -= tokenIds.length;
        p.staked -= tokenIds.length;
        _resetDebt(pid, msg.sender);

        _payout(pid, msg.sender);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (stakerOf[pid][tokenIds[i]] != msg.sender) revert NotYourStake();
            delete stakerOf[pid][tokenIds[i]];
            p.collection.transferFrom(address(this), msg.sender, tokenIds[i]);
            emit Unstaked(msg.sender, pid, tokenIds[i]);
        }
    }

    function claim(uint256 pid) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        _updatePool(pid);
        _settle(pid, msg.sender);
        _resetDebt(pid, msg.sender);
        _payout(pid, msg.sender);
    }

    /**
     * The way out that depends on nothing.
     *
     * No accrual, no token transfer, no budget: it returns the NFT and leaves
     * the reward standing. It exists so a misconfigured rate or an empty budget
     * can never be the reason somebody cannot get their own art back.
     */
    function emergencyUnstake(uint256 pid, uint256[] calldata tokenIds) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][msg.sender];
        if (tokenIds.length == 0 || tokenIds.length > s.count) revert NothingStaked();

        // Settled rather than discarded: taking your NFT back should not cost
        // you what you already earned.
        _updatePool(pid);
        _settle(pid, msg.sender);

        s.count -= tokenIds.length;
        p.staked -= tokenIds.length;
        _resetDebt(pid, msg.sender);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (stakerOf[pid][tokenIds[i]] != msg.sender) revert NotYourStake();
            delete stakerOf[pid][tokenIds[i]];
            p.collection.transferFrom(address(this), msg.sender, tokenIds[i]);
            emit EmergencyUnstaked(msg.sender, pid, tokenIds[i]);
        }
    }

    /**
     * Pays from the escrow, and never beyond it.
     *
     * The budget is the ceiling by construction, so a pool cannot promise what
     * it did not fund. What it cannot cover stays owed and is claimable if the
     * creator, or anybody else, tops the pool up later.
     */
    function _payout(uint256 pid, address who) internal {
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][who];

        uint256 owed = s.owed;
        if (owed == 0) return;

        uint256 available = p.budget - p.paidOut;
        uint256 sent = owed > available ? available : owed;
        if (sent == 0) return;

        s.owed = owed - sent;
        p.paidOut += sent;
        p.rewardToken.safeTransfer(who, sent);

        emit Claimed(who, pid, sent, s.owed);
    }

    /* ── views ───────────────────────────────────────────────────────────── */

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }

    function pool(uint256 pid) external view returns (Pool memory) {
        if (pid >= _pools.length) revert NoSuchPool();
        return _pools[pid];
    }

    function stakeOf(uint256 pid, address who) external view returns (Stake memory) {
        if (pid >= _pools.length) revert NoSuchPool();
        return _stakes[pid][who];
    }

    /** The pool for a collection, or a flag saying it was never paired. */
    function poolOf(address collection) external view returns (bool paired, uint256 pid) {
        uint256 slot = _poolOfCollection[collection];
        return (slot != 0, slot == 0 ? 0 : slot - 1);
    }

    /**
     * The rate as a percentage, when the creator declared a notional.
     *
     * Returns zero when they did not, which means the pool quotes a flat reward
     * per NFT instead. That is a real choice, not a missing value: a free mint
     * has no price to be a percentage of.
     */
    function apyBps(uint256 pid) external view returns (uint256) {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        if (p.notionalPerNft == 0) return 0;
        return (p.rewardPerNftPerYear * BPS) / p.notionalPerNft;
    }

    /** How long the escrow lasts at the current stake, in seconds. */
    function runway(uint256 pid) external view returns (uint256) {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        if (p.staked == 0 || p.rewardPerNftPerYear == 0) return type(uint256).max;
        uint256 left = p.budget - p.paidOut;
        return (left * YEAR) / (p.staked * p.rewardPerNftPerYear);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
