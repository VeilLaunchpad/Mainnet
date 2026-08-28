// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILockedToken {
    // Void returns so one interface covers OpenZeppelin's ERC20 (returns bool)
    // and COTI's PrivateERC20 (returns nothing).
    function transfer(address to, uint256 amount) external;
    function transferFrom(address from, address to, uint256 amount) external;
}

/**
 * @title VeilLocker - a timelock for a creator's own allocation.
 *
 * A launch can send the creator's dev-buy here instead of to their wallet. The
 * lock is recorded in plain storage on purpose: the whole point of locking is
 * that buyers can verify it, so the amount and the unlock date have to be
 * readable even when the token itself is private.
 *
 * There is no owner, no early-release path and no way to change an unlock date
 * once set. A lock that the deployer could undo would not be a lock.
 */
contract VeilLocker is ReentrancyGuard {
    struct Lock {
        address token;
        address beneficiary;
        uint256 amount;
        uint64 unlockAt;
        bool claimed;
    }

    Lock[] private _locks;

    mapping(address => uint256[]) public locksOfToken;
    mapping(address => uint256[]) public locksOfBeneficiary;

    /// Total still held per token, so a page can show it without a scan.
    mapping(address => uint256) public lockedOf;

    event Locked(
        uint256 indexed id,
        address indexed token,
        address indexed beneficiary,
        uint256 amount,
        uint64 unlockAt
    );
    event Claimed(uint256 indexed id, address indexed token, address indexed beneficiary, uint256 amount);

    error ZeroAmount();
    error NotBeneficiary();
    error StillLocked(uint64 unlockAt);
    error AlreadyClaimed();

    /**
     * Pulls `amount` from the caller and holds it until `unlockAt`. The caller
     * approves this contract first, which is why the launch factory does the
     * approving rather than the creator.
     */
    function lock(
        address token,
        address beneficiary,
        uint256 amount,
        uint64 unlockAt
    ) external nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();

        ILockedToken(token).transferFrom(msg.sender, address(this), amount);

        id = _locks.length;
        _locks.push(
            Lock({
                token: token,
                beneficiary: beneficiary,
                amount: amount,
                unlockAt: unlockAt,
                claimed: false
            })
        );

        locksOfToken[token].push(id);
        locksOfBeneficiary[beneficiary].push(id);
        lockedOf[token] += amount;

        emit Locked(id, token, beneficiary, amount, unlockAt);
    }

    function claim(uint256 id) external nonReentrant {
        Lock storage l = _locks[id];

        if (msg.sender != l.beneficiary) revert NotBeneficiary();
        if (l.claimed) revert AlreadyClaimed();
        if (block.timestamp < l.unlockAt) revert StillLocked(l.unlockAt);

        l.claimed = true;
        lockedOf[l.token] -= l.amount;

        ILockedToken(l.token).transfer(l.beneficiary, l.amount);

        emit Claimed(id, l.token, l.beneficiary, l.amount);
    }

    // ── views ─────────────────────────────────────────────────────────────

    function lockCount() external view returns (uint256) {
        return _locks.length;
    }

    function lockAt(uint256 id)
        external
        view
        returns (address token, address beneficiary, uint256 amount, uint64 unlockAt, bool claimed)
    {
        Lock storage l = _locks[id];
        return (l.token, l.beneficiary, l.amount, l.unlockAt, l.claimed);
    }

    function locksForToken(address token) external view returns (uint256[] memory) {
        return locksOfToken[token];
    }

    function locksForBeneficiary(address who) external view returns (uint256[] memory) {
        return locksOfBeneficiary[who];
    }

    function claimable(uint256 id) external view returns (bool) {
        Lock storage l = _locks[id];
        return !l.claimed && block.timestamp >= l.unlockAt;
    }
}
