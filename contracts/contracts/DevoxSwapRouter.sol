// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DevoxSwapPair} from "./DevoxSwapPair.sol";
import {DevoxSwapFactory} from "./DevoxSwapFactory.sol";

interface IWCOTIRouter {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IRouterToken {
    // Void return: fits both OpenZeppelin ERC20 (returns bool) and COTI
    // PrivateERC20 (returns nothing).
    function transferFrom(address from, address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external;
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title DevoxSwapRouter - native COTI in, native COTI out.
 *
 * The pairs pull their own tokens, so the router's job is narrow: wrap and
 * unwrap native COTI around a swap, apply a deadline, and expose quotes. It
 * holds no funds between calls and has no admin.
 */
contract DevoxSwapRouter is ReentrancyGuard {
    DevoxSwapFactory public immutable factory;
    address public immutable wcoti;

    error Expired();
    error NoPair();
    error InsufficientOutput();
    error TransferFailed();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address factory_, address wcoti_) {
        factory = DevoxSwapFactory(factory_);
        wcoti = wcoti_;
    }

    receive() external payable {
        // Only the wrapper may push COTI here, during an unwrap.
        require(msg.sender == wcoti, "DevoxSwapRouter: direct send");
    }

    // ── quotes ────────────────────────────────────────────────────────────

    function pairFor(address tokenA, address tokenB) public view returns (address) {
        return factory.getPair(tokenA, tokenB);
    }

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) public view returns (uint256) {
        address pair = factory.getPair(tokenIn, tokenOut);
        if (pair == address(0)) return 0;
        return DevoxSwapPair(pair).quote(tokenIn, amountIn);
    }

    /// Price of one whole `token` denominated in COTI, scaled to 1e18.
    function priceInCoti(address token) external view returns (uint256) {
        address pair = factory.getPair(token, wcoti);
        if (pair == address(0)) return 0;
        DevoxSwapPair p = DevoxSwapPair(pair);
        (uint256 r0, uint256 r1) = p.getReserves();
        if (r0 == 0 || r1 == 0) return 0;
        (uint256 rToken, uint256 rCoti) = p.token0() == token ? (r0, r1) : (r1, r0);
        return (rCoti * 1e18) / rToken;
    }

    function quoteBuyWithCoti(address token, uint256 cotiIn) external view returns (uint256) {
        return getAmountOut(wcoti, token, cotiIn);
    }

    function quoteSellForCoti(address token, uint256 tokenIn) external view returns (uint256) {
        return getAmountOut(token, wcoti, tokenIn);
    }

    // ── swaps ─────────────────────────────────────────────────────────────

    /// Native COTI -> token. Wraps, swaps, and sends the token straight to `to`.
    function swapExactCotiForTokens(
        address token,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (uint256 amountOut) {
        address pair = factory.getPair(wcoti, token);
        if (pair == address(0)) revert NoPair();

        IWCOTIRouter(wcoti).deposit{value: msg.value}();
        _approvePair(wcoti, pair, msg.value);

        amountOut = DevoxSwapPair(pair).swapExactIn(wcoti, msg.value, amountOutMin, to, deadline);
    }

    /// Token -> native COTI. The caller approves this router for `amountIn`.
    function swapExactTokensForCoti(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountOut) {
        address pair = factory.getPair(token, wcoti);
        if (pair == address(0)) revert NoPair();

        IRouterToken(token).transferFrom(msg.sender, address(this), amountIn);
        _approvePair(token, pair, amountIn);

        // Land the WCOTI here so it can be unwrapped before forwarding.
        amountOut = DevoxSwapPair(pair).swapExactIn(token, amountIn, amountOutMin, address(this), deadline);

        IWCOTIRouter(wcoti).withdraw(amountOut);
        (bool ok, ) = to.call{value: amountOut}("");
        if (!ok) revert TransferFailed();
    }

    /// Token -> token, single hop.
    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountOut) {
        address pair = factory.getPair(tokenIn, tokenOut);
        if (pair == address(0)) revert NoPair();

        IRouterToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        _approvePair(tokenIn, pair, amountIn);

        amountOut = DevoxSwapPair(pair).swapExactIn(tokenIn, amountIn, amountOutMin, to, deadline);
    }

    // ── liquidity ─────────────────────────────────────────────────────────

    /// Adds token + native COTI liquidity, creating the pair if needed.
    function addLiquidityCoti(
        address token,
        uint256 amountToken,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (uint256 liquidity) {
        address pair = factory.getPair(token, wcoti);
        if (pair == address(0)) pair = factory.createPair(token, wcoti);

        IRouterToken(token).transferFrom(msg.sender, address(this), amountToken);
        IWCOTIRouter(wcoti).deposit{value: msg.value}();

        _approvePair(token, pair, amountToken);
        _approvePair(wcoti, pair, msg.value);

        DevoxSwapPair p = DevoxSwapPair(pair);
        (uint256 amount0, uint256 amount1) = p.token0() == token
            ? (amountToken, msg.value)
            : (msg.value, amountToken);

        liquidity = p.addLiquidity(amount0, amount1, to);
    }

    /**
     * COTI's PrivateERC20 refuses to overwrite a non-zero allowance with
     * another non-zero value - a deliberate mitigation for the classic ERC20
     * approve race. So reset to zero first, every time.
     */
    function _approvePair(address token, address pair, uint256 amount) internal {
        if (IRouterToken(token).allowance(address(this), pair) != 0) {
            IRouterToken(token).approve(pair, 0);
        }
        IRouterToken(token).approve(pair, amount);
    }
}
