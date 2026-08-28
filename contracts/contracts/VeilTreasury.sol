// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VeilTreasury - the reward reserve behind staking.
 *
 * Staking pays a fixed percentage, which means the rewards have to come from
 * somewhere that is not the stakers' own deposits. This holds that reserve, and
 * the separation is the whole point: principal never enters this contract, so
 * there is no path by which one person's stake can be paid out as another
 * person's reward.
 *
 * Only an approved spender can move funds out as rewards, and in practice that
 * is exactly one address: the staking contract. The owner can fund it, approve
 * a spender, and withdraw the unspent reserve - and that last power is real, so
 * it is stated plainly here rather than buried. What the owner cannot do is
 * touch a single token anyone has staked, because none of it is here.
 *
 * `paidOut` and `balance()` are public so the runway is checkable from outside:
 * how much reward has ever left, and how much is left to pay.
 */
contract VeilTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// The reward asset. Fixed at construction so a spender cannot be pointed elsewhere.
    IERC20 public immutable rewardToken;

    /// Addresses allowed to pay rewards out. The staking contract, and nothing else.
    mapping(address => bool) public isSpender;

    /**
     * How much each spender may still pay out in total.
     *
     * Approval alone would be a blank cheque over the whole reserve, and the
     * staking contract's own owner decides what pools exist and at what rate -
     * so an unbounded grant would let that role drain this one without the
     * treasury owner ever acting. The budget is what keeps the two powers
     * genuinely separate, and it is raised deliberately rather than by default.
     */
    mapping(address => uint256) public spendLimit;

    /// Lifetime rewards paid, for anyone auditing the reserve.
    uint256 public paidOut;

    event SpenderSet(address indexed spender, bool allowed, uint256 limit);
    event Funded(address indexed from, uint256 amount);
    event RewardPaid(address indexed spender, address indexed to, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotSpender();

    constructor(address rewardToken_, address owner_) Ownable(owner_) {
        require(rewardToken_ != address(0), "reward token is zero");
        rewardToken = IERC20(rewardToken_);
    }

    modifier onlySpender() {
        if (!isSpender[msg.sender]) revert NotSpender();
        _;
    }

    /** What the reserve can still pay. */
    function balance() public view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    function setSpender(address spender, bool allowed, uint256 limit) external onlyOwner {
        require(spender != address(0), "spender is zero");
        isSpender[spender] = allowed;
        spendLimit[spender] = limit;
        emit SpenderSet(spender, allowed, limit);
    }

    /**
     * Top the reserve up.
     *
     * A plain transfer to this address works too and is not rejected; this
     * exists so funding shows up as an event with a sender attached instead of
     * having to be inferred from a token transfer log.
     */
    function fund(uint256 amount) external nonReentrant {
        require(amount > 0, "amount is zero");
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /**
     * Pay a reward.
     *
     * Returns what was actually sent rather than reverting when the reserve has
     * run dry. The caller is a staking contract mid-claim: reverting there would
     * strand a user who has genuinely earned something and would also block
     * their unstake if the two share a code path. Paying what is left and
     * reporting it lets the staking contract keep the remainder owed.
     */
    function payReward(address to, uint256 amount) external onlySpender nonReentrant returns (uint256 sent) {
        if (amount == 0 || to == address(0)) return 0;

        uint256 available = balance();
        uint256 budget = spendLimit[msg.sender];
        if (budget < available) available = budget;

        sent = amount > available ? available : amount;
        if (sent == 0) return 0;

        spendLimit[msg.sender] = budget - sent;
        paidOut += sent;
        rewardToken.safeTransfer(to, sent);
        emit RewardPaid(msg.sender, to, sent);
    }

    /**
     * Recover the unspent reserve, or any token sent here by mistake.
     *
     * This is an owner power over the reward reserve only. It cannot reach
     * staked principal, which lives in the staking contract and never moves
     * through here.
     */
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to is zero");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
