// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DevoxTestToken - a stand-in for a mainnet asset, on testnet only.
 *
 * The COTI privacy portal carries seven assets on mainnet: COTI, wETH, wBTC,
 * USDT, USDC.e, wADA and gCOTI. None of them exist on testnet, so testing the
 * portal against a realistic set means deploying stand-ins.
 *
 * These are exactly what they look like: an open faucet with no supply cap and
 * no value. Decimals are copied from the real asset, because that is the detail
 * a wrapper gets wrong: a six-decimal stablecoin treated as eighteen misprices
 * by a factor of a trillion.
 */
contract DevoxTestToken is ERC20 {
    uint8 private immutable _decimals;

    /// The asset this stands in for, so nobody mistakes it for the real thing.
    string public represents;

    /// Per-call faucet limit. Deliberately small; this is not a treasury.
    uint256 public immutable faucetAmount;

    event Minted(address indexed to, uint256 amount);

    error FaucetLimit();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory represents_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        represents = represents_;
        faucetAmount = 1_000 * 10 ** decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// Anyone can mint up to the faucet limit. There is nothing here to steal.
    function faucet() external {
        _mint(msg.sender, faucetAmount);
        emit Minted(msg.sender, faucetAmount);
    }

    function mint(address to, uint256 amount) external {
        if (amount > faucetAmount * 100) revert FaucetLimit();
        _mint(to, amount);
        emit Minted(to, amount);
    }
}
