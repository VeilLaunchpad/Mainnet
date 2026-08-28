// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Treasuries that misbehave, for tests only.
 *
 * `setTreasury` lets an owner point staking at any contract, so the staking
 * contract has to survive one that lies about paying and one that reverts
 * outright. Both are cheaper to write than to reason about.
 */

/// Reports a payment it never makes.
contract LyingTreasury {
    function payReward(address, uint256 amount) external pure returns (uint256) {
        return amount; // claims success, transfers nothing
    }

    function balance() external pure returns (uint256) {
        return type(uint256).max;
    }
}

/// Refuses every call.
contract RevertingTreasury {
    function payReward(address, uint256) external pure returns (uint256) {
        revert("no");
    }

    function balance() external pure returns (uint256) {
        return 0;
    }
}
