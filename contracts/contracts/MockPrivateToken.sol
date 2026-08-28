// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * A token that answers balanceOf with a meaningless handle, for tests only.
 *
 * COTI's PrivateERC20 keeps balances as ciphertext, so `balanceOf` returns a
 * pointer to an encrypted value rather than an amount. Any accounting that
 * subtracts two such reads gets nonsense. This reproduces that behaviour
 * faithfully enough to prove the staking contract does not rely on it.
 */
contract MockPrivateToken {
    string public name = "Private COTI";
    string public symbol = "pCOTI";
    uint8 public constant decimals = 18;

    mapping(address => uint256) private _real;
    mapping(address => mapping(address => uint256)) public allowance;

    /// Deliberately unrelated to the real balance, like a ciphertext handle.
    function balanceOf(address) external view returns (uint256) {
        return uint256(keccak256(abi.encode(block.number, "ciphertext")));
    }

    /// What a test needs to check the real position, which a caller cannot see.
    function realBalanceOf(address who) external view returns (uint256) {
        return _real[who];
    }

    function mint(address to, uint256 amount) external {
        _real[to] += amount;
    }

    // Void returns, exactly like the real PrivateERC20.
    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        require(_real[msg.sender] >= amount, "balance");
        _real[msg.sender] -= amount;
        _real[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(_real[from] >= amount, "balance");
        if (from != msg.sender) {
            require(allowance[from][msg.sender] >= amount, "allowance");
            allowance[from][msg.sender] -= amount;
        }
        _real[from] -= amount;
        _real[to] += amount;
    }
}
