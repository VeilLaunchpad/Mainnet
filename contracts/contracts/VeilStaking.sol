// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVeilTreasury {
    function payReward(address to, uint256 amount) external returns (uint256 sent);
    function balance() external view returns (uint256);
}

/**
 * @title VeilStaking - stake, and earn VEILPAD at a stated percentage.
 *
 * Each pool pays a fixed APY rather than splitting a fixed emission. The
 * difference matters to whoever is staking: a fixed emission means your yield
 * falls every time somebody else deposits, whereas here the percentage you were
 * shown is the percentage you get, and it does not move because the pool grew.
 *
 * That guarantee costs something, and the cost is solvency. A fixed rate on an
 * unbounded deposit is an unbounded liability, so every pool carries a cap, and
 * the cap is what actually bounds what the treasury can owe. Rewards are paid
 * from VeilTreasury, never from deposits, so the reserve running dry can delay
 * a reward but can never touch a principal.
 *
 * Accounting is the standard per-share accumulator. `accRewardPerShare` is the
 * reward one whole staked token has earned since the pool opened; a staker's
 * debt is that figure snapshotted when they last touched the pool, and the
 * difference is what they are owed. Because it is per-token rather than
 * per-pool, time passing with an empty pool creates nothing to claim.
 */
contract VeilStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Native COTI is spelled as the zero address, the same convention VeilPortal uses.
    address public constant NATIVE = address(0);

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    /// A ceiling on the rate, so a mistyped APY cannot silently promise 400x.
    uint256 public constant MAX_APY_BPS = 100_000; // 1000%

    struct Pool {
        /// The asset being staked. `NATIVE` for COTI itself.
        address stakeToken;
        /// Annual percentage, in basis points. 1000 = 10%.
        uint32 apyBps;
        /// Whether new deposits are accepted. Withdrawals never depend on this.
        bool active;
        /**
         * True when the stake token keeps balances as ciphertext.
         *
         * A COTI PrivateERC20 answers `balanceOf` with a handle to an encrypted
         * value, not a number. The usual trick of measuring this contract's
         * balance before and after a transfer - which is how a fee-on-transfer
         * token is caught out - reads two ciphertext handles and subtracts them,
         * producing a figure that means nothing at all.
         *
         * So a private pool credits the amount asked for. That is safe here for
         * the reason the measurement existed: COTI's private tokens move the
         * exact amount, and a token that did not could never be listed as a pool
         * in the first place, since only the owner opens one.
         */
        bool privateToken;
        /// 10 ** (18 - decimals), so an 8-decimal token earns the same rate as an 18.
        uint256 scale;
        /// Most that may be staked here in total. The bound on what can be owed.
        uint256 cap;
        /// Smallest deposit, to keep dust out of the accounting.
        uint256 minStake;
        /**
         * Most any one address may hold here. Zero means no limit.
         *
         * Without it a single deposit can take a whole pool's cap the moment it
         * opens and hold the entire reward budget, at no cost and with an exit
         * whenever it suits. A per-address ceiling does not make that
         * impossible - addresses are free - but it makes it work rather than a
         * single transaction.
         */
        uint256 maxPerUser;
        uint256 totalStaked;
        uint256 accRewardPerShare;
        uint64 lastUpdate;
    }

    struct Stake {
        uint256 amount;
        uint256 rewardDebt;
        /// Earned but not yet handed over, because the reserve was short.
        uint256 owed;
        uint64 since;
    }

    IVeilTreasury public treasury;
    IERC20 public immutable rewardToken;

    Pool[] private _pools;
    mapping(uint256 => mapping(address => Stake)) private _stakes;

    /// Stops new deposits everywhere at once. Never blocks a withdrawal.
    bool public depositsPaused;

    event PoolAdded(uint256 indexed pid, address indexed stakeToken, uint32 apyBps, uint256 cap);
    event PoolUpdated(uint256 indexed pid, uint32 apyBps, uint256 cap, bool active);
    event Staked(address indexed user, uint256 indexed pid, uint256 amount);
    event Unstaked(address indexed user, uint256 indexed pid, uint256 amount);
    event Claimed(address indexed user, uint256 indexed pid, uint256 paid, uint256 stillOwed);
    /// The reserve could not pay at all. The debt survives and stays claimable.
    event ClaimDeferred(address indexed user, uint256 indexed pid, uint256 owed);
    event EmergencyUnstaked(address indexed user, uint256 indexed pid, uint256 amount, uint256 stillOwed);
    event TreasurySet(address indexed treasury);
    event DepositsPaused(bool paused);

    error NoSuchPool();
    error PoolClosed();
    error BelowMinimum();
    error CapReached();
    error PerUserCapReached();
    error NothingStaked();
    error WrongValue();
    error NativeTransferFailed();

    constructor(address rewardToken_, address treasury_, address owner_) Ownable(owner_) {
        require(rewardToken_ != address(0), "reward token is zero");
        rewardToken = IERC20(rewardToken_);
        treasury = IVeilTreasury(treasury_);
        emit TreasurySet(treasury_);
    }

    /* ── pools ──────────────────────────────────────────────────────────── */

    function poolCount() external view returns (uint256) {
        return _pools.length;
    }

    function pool(uint256 pid) external view returns (Pool memory) {
        if (pid >= _pools.length) revert NoSuchPool();
        return _pools[pid];
    }

    function stakeOf(uint256 pid, address user) external view returns (Stake memory) {
        if (pid >= _pools.length) revert NoSuchPool();
        return _stakes[pid][user];
    }

    /**
     * Opens a pool.
     *
     * The stake token's decimals are read once and turned into a scale factor,
     * so an 8-decimal asset earns the same percentage as an 18-decimal one
     * instead of a hundred-billionth of it.
     */
    function addPool(
        address stakeToken,
        uint32 apyBps,
        uint256 cap,
        uint256 minStake,
        uint256 maxPerUser,
        bool privateToken
    ) external onlyOwner returns (uint256 pid) {
        require(apyBps <= MAX_APY_BPS, "apy too high");
        require(cap > 0, "cap is zero");
        require(maxPerUser == 0 || maxPerUser >= minStake, "per-user cap below minimum");

        uint256 scale = 1;
        if (stakeToken != NATIVE) {
            uint8 d = IERC20Metadata(stakeToken).decimals();
            require(d <= 18, "decimals above 18");
            scale = 10 ** (18 - d);
        }

        _pools.push(
            Pool({
                stakeToken: stakeToken,
                apyBps: apyBps,
                active: true,
                privateToken: privateToken,
                scale: scale,
                cap: cap,
                minStake: minStake,
                maxPerUser: maxPerUser,
                totalStaked: 0,
                accRewardPerShare: 0,
                lastUpdate: uint64(block.timestamp)
            })
        );

        pid = _pools.length - 1;
        emit PoolAdded(pid, stakeToken, apyBps, cap);
    }

    /**
     * Changes a pool's terms.
     *
     * The pool is settled first, so everything earned up to this moment is
     * locked in at the old rate. Without that, lowering the APY would silently
     * reprice rewards somebody had already earned.
     */
    function setPool(
        uint256 pid,
        uint32 apyBps,
        uint256 cap,
        uint256 maxPerUser,
        bool active
    ) external onlyOwner {
        if (pid >= _pools.length) revert NoSuchPool();
        require(apyBps <= MAX_APY_BPS, "apy too high");

        _updatePool(pid);

        Pool storage p = _pools[pid];
        p.apyBps = apyBps;
        p.cap = cap;
        p.maxPerUser = maxPerUser;
        p.active = active;

        emit PoolUpdated(pid, apyBps, cap, active);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = IVeilTreasury(treasury_);
        emit TreasurySet(treasury_);
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    /* ── accrual ────────────────────────────────────────────────────────── */

    function _updatePool(uint256 pid) internal {
        Pool storage p = _pools[pid];
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs <= p.lastUpdate) return;

        uint256 elapsed = nowTs - p.lastUpdate;
        p.accRewardPerShare += (elapsed * p.apyBps * PRECISION) / (BPS * YEAR);
        p.lastUpdate = nowTs;
    }

    /** What a pool's accumulator would read right now, without writing it. */
    function _accNow(Pool storage p) internal view returns (uint256) {
        if (block.timestamp <= p.lastUpdate) return p.accRewardPerShare;
        uint256 elapsed = block.timestamp - p.lastUpdate;
        return p.accRewardPerShare + (elapsed * p.apyBps * PRECISION) / (BPS * YEAR);
    }

    /** Everything a staker has earned and not yet received, unpaid balance included. */
    function pendingReward(uint256 pid, address user) public view returns (uint256) {
        if (pid >= _pools.length) return 0;
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][user];

        uint256 acc = _accNow(p);
        uint256 normalized = s.amount * p.scale;
        uint256 accrued = (normalized * acc) / PRECISION;

        // A debt above the accrued figure would mean the accumulator moved
        // backwards, which it cannot; the guard is here so a future change
        // cannot turn an underflow into a revert on a view.
        uint256 fresh = accrued > s.rewardDebt ? accrued - s.rewardDebt : 0;
        return s.owed + fresh;
    }

    /** Moves fresh earnings into `owed` and resets the debt. */
    function _settle(uint256 pid, address user) internal {
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][user];

        uint256 normalized = s.amount * p.scale;
        uint256 accrued = (normalized * p.accRewardPerShare) / PRECISION;
        if (accrued > s.rewardDebt) s.owed += accrued - s.rewardDebt;
        s.rewardDebt = accrued;
    }

    function _resetDebt(uint256 pid, address user) internal {
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][user];
        s.rewardDebt = (s.amount * p.scale * p.accRewardPerShare) / PRECISION;
    }

    /* ── staking ────────────────────────────────────────────────────────── */

    function stake(uint256 pid, uint256 amount) external payable nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        if (!p.active || depositsPaused) revert PoolClosed();

        uint256 received;
        if (p.stakeToken == NATIVE) {
            if (msg.value != amount) revert WrongValue();
            received = msg.value;
        } else {
            if (msg.value != 0) revert WrongValue();
            // Measured rather than assumed, so a token that takes a cut on
            // transfer credits what actually arrived instead of what was asked
            // for - which would otherwise leave the pool short of its own books.
            IERC20 t = IERC20(p.stakeToken);
            if (p.privateToken) {
                // Its balance is ciphertext, so there is nothing to measure.
                t.safeTransferFrom(msg.sender, address(this), amount);
                received = amount;
            } else {
                uint256 before = t.balanceOf(address(this));
                t.safeTransferFrom(msg.sender, address(this), amount);
                received = t.balanceOf(address(this)) - before;
            }
        }

        if (received < p.minStake) revert BelowMinimum();
        if (p.totalStaked + received > p.cap) revert CapReached();
        if (p.maxPerUser != 0 && _stakes[pid][msg.sender].amount + received > p.maxPerUser) {
            revert PerUserCapReached();
        }

        _updatePool(pid);
        _settle(pid, msg.sender);

        Stake storage s = _stakes[pid][msg.sender];
        s.amount += received;
        if (s.since == 0) s.since = uint64(block.timestamp);
        p.totalStaked += received;

        _resetDebt(pid, msg.sender);
        emit Staked(msg.sender, pid, received);
    }

    /**
     * Takes principal back out, and pays whatever has been earned along with it.
     *
     * Deliberately independent of `active` and of `depositsPaused`: closing a
     * pool stops new money going in, and must never trap money already in.
     */
    function unstake(uint256 pid, uint256 amount) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][msg.sender];
        if (amount == 0 || amount > s.amount) revert NothingStaked();

        _updatePool(pid);
        _settle(pid, msg.sender);

        s.amount -= amount;
        p.totalStaked -= amount;
        if (s.amount == 0) s.since = 0;
        _resetDebt(pid, msg.sender);

        _payout(pid, msg.sender);
        _send(p.stakeToken, msg.sender, amount);

        emit Unstaked(msg.sender, pid, amount);
    }

    /** Takes the reward and leaves the principal staked. */
    function claim(uint256 pid) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        _updatePool(pid);
        _settle(pid, msg.sender);
        _resetDebt(pid, msg.sender);
        _payout(pid, msg.sender);
    }

    /**
     * The way out that depends on nothing else.
     *
     * No treasury call, no accrual, no reward maths: it returns the principal
     * and touches nothing else. It exists so a broken or drained treasury can
     * never become a reason somebody cannot get their own deposit back.
     *
     * What it does not do is burn the reward, and getting that right took two
     * goes. Clearing `owed` was the obvious mistake and went first. The subtler
     * one was zeroing `rewardDebt` without settling: everything earned since
     * the staker last touched the pool lives in the gap between the accumulator
     * and that debt, so discarding it cost a passive staker their entire
     * reward - the people the escape hatch exists for, losing the most by using
     * it.
     *
     * Settling first fixes it, and costs nothing that matters. `_updatePool`
     * and `_settle` are storage arithmetic with no external call and no
     * realistic overflow, so the property that makes this function a safe last
     * resort - that it depends on nothing outside this contract - is untouched.
     * Now the full amount lands in `owed` and stays claimable through `claim`
     * once the reserve is healthy. Nothing is forfeited at all.
     */
    function emergencyUnstake(uint256 pid) external nonReentrant {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        Stake storage s = _stakes[pid][msg.sender];

        uint256 amount = s.amount;
        if (amount == 0) revert NothingStaked();

        _updatePool(pid);
        _settle(pid, msg.sender);

        s.amount = 0;
        s.rewardDebt = 0;
        s.since = 0;
        p.totalStaked -= amount;

        _send(p.stakeToken, msg.sender, amount);
        emit EmergencyUnstaked(msg.sender, pid, amount, s.owed);
    }

    /**
     * Hands over what the reserve can cover and keeps the rest owed.
     *
     * Two things here are deliberate and both exist because the treasury is a
     * separate contract that can be repointed by `setTreasury`.
     *
     * The credit is the measured change in the user's balance, not the figure
     * the treasury returns. A treasury that reported a payment it never made
     * would otherwise wipe the debt from the books and destroy the reward.
     * Believing an external contract's account of its own behaviour is exactly
     * the thing not to do.
     *
     * And the call is wrapped, so a treasury that reverts - or has no code at
     * all - cannot brick `unstake`. A reward that could not be paid stays owed
     * and is claimable later; a principal that could not be returned would be a
     * far worse failure, so the withdrawal completes either way.
     */
    function _payout(uint256 pid, address user) internal {
        Stake storage s = _stakes[pid][user];
        uint256 owed = s.owed;
        if (owed == 0) return;

        // Cleared before the external call, and restored to the unpaid
        // remainder afterwards, so a re-entrant claim finds nothing to take.
        s.owed = 0;

        /**
         * `try` does not cover this case. Solidity emits an EXTCODESIZE check
         * before a call that expects return data, and that check reverts
         * outside the try block - so an address with no code, which is what
         * `setTreasury(address(0))` or a mistyped address gives you, would
         * revert `unstake` itself rather than being caught. Checking first is
         * the only thing that keeps a withdrawal working through that mistake.
         */
        if (address(treasury).code.length == 0) {
            s.owed = owed;
            emit ClaimDeferred(user, pid, owed);
            return;
        }

        uint256 before = rewardToken.balanceOf(user);

        try treasury.payReward(user, owed) returns (uint256 reported) {
            uint256 delivered = rewardToken.balanceOf(user) - before;
            uint256 sent = delivered < reported ? delivered : reported;
            if (sent < owed) s.owed = owed - sent;
            emit Claimed(user, pid, sent, s.owed);
        } catch {
            s.owed = owed;
            emit ClaimDeferred(user, pid, owed);
        }
    }

    function _send(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == NATIVE) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /* ── views the app reads ────────────────────────────────────────────── */

    /** Everything a page needs for one pool, in a single call. */
    function poolView(uint256 pid)
        external
        view
        returns (
            address stakeToken,
            uint32 apyBps,
            bool active,
            uint256 totalStaked,
            uint256 cap,
            uint256 minStake,
            uint256 maxPerUser,
            bool privateToken,
            uint256 rewardsAvailable
        )
    {
        if (pid >= _pools.length) revert NoSuchPool();
        Pool storage p = _pools[pid];
        return (
            p.stakeToken,
            p.apyBps,
            p.active,
            p.totalStaked,
            p.cap,
            p.minStake,
            p.maxPerUser,
            p.privateToken,
            address(treasury) == address(0) ? 0 : treasury.balance()
        );
    }

    /**
     * Native COTI arriving on its own is refused.
     *
     * A bare transfer would sit here uncounted, outside every pool's books, and
     * look to a reader like principal that belongs to someone. Staking has an
     * entrypoint; this is not it.
     */
    receive() external payable {
        revert WrongValue();
    }
}
