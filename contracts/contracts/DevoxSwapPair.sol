// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDevoxTransferable {
    // Declared void so one interface fits both shapes: OpenZeppelin's ERC20
    // returns bool, COTI's PrivateERC20 returns nothing. Extra return data is
    // ignored by the ABI decoder; a missing bool would not be.
    function transfer(address to, uint256 amount) external;
    function transferFrom(address from, address to, uint256 amount) external;
}

/**
 * @title DevoxSwapPair - a constant-product AMM that works with encrypted tokens.
 *
 * Uniswap V2 derives its reserves from `balanceOf(address(this))`. That is
 * exactly what a COTI PrivateERC20 cannot answer: `balanceOf` returns a
 * ctUint256 ciphertext handle, not a number. Dropped into a V2 pair it would
 * produce garbage reserves and drain instantly.
 *
 * So this pair never reads a balance. It pulls tokens itself with
 * `transferFrom` and credits its own `reserve0`/`reserve1`, which means the
 * amount is known because *this contract moved it*, not because it asked the
 * token. Everything else - x*y=k, the 0.3% fee, LP shares, the locked minimum
 * liquidity - is the V2 design.
 *
 * The trade-off, stated plainly: because reserves are internal, a raw transfer
 * into this contract is a donation that no one can claim, and fee-on-transfer
 * tokens are unsupported. Both are acceptable; reading an encrypted balance is
 * not possible at all.
 */
contract DevoxSwapPair is ReentrancyGuard {
    // ── LP token (public on purpose: shares must be transferable and readable)
    string public constant name = "DevoxSwap LP";
    string public constant symbol = "DEVOX-LP";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ── pair state
    address public immutable factory;
    address public token0;
    address public token1;

    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public kLast;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant FEE_BPS = 30; // 0.3%, the V2 default

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        address indexed to
    );
    event Sync(uint256 reserve0, uint256 reserve1);

    error Forbidden();
    error AlreadyInitialized();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientInput();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error InvalidToken();
    error Expired();

    constructor() {
        factory = msg.sender;
    }

    function initialize(address token0_, address token1_) external {
        if (msg.sender != factory) revert Forbidden();
        if (token0 != address(0)) revert AlreadyInitialized();
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    // ── LP token mechanics ────────────────────────────────────────────────

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transferLp(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "DevoxSwap: LP allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transferLp(from, to, value);
        return true;
    }

    function _transferLp(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "DevoxSwap: LP balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mintLp(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burnLp(address from, uint256 value) internal {
        require(balanceOf[from] >= value, "DevoxSwap: LP balance");
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    // ── liquidity ─────────────────────────────────────────────────────────

    /**
     * Pulls both sides from the caller and mints LP shares. The caller must
     * have approved this pair for both tokens.
     */
    function addLiquidity(
        uint256 amount0,
        uint256 amount1,
        address to
    ) external nonReentrant returns (uint256 liquidity) {
        if (amount0 == 0 || amount1 == 0) revert InsufficientInput();

        IDevoxTransferable(token0).transferFrom(msg.sender, address(this), amount0);
        IDevoxTransferable(token1).transferFrom(msg.sender, address(this), amount1);

        uint256 supply = totalSupply;
        if (supply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // Burned forever, so the pool can never be fully drained and the
            // share price cannot be manipulated by emptying it.
            _mintLp(address(0), MINIMUM_LIQUIDITY);
        } else {
            uint256 byToken0 = (amount0 * supply) / reserve0;
            uint256 byToken1 = (amount1 * supply) / reserve1;
            liquidity = byToken0 < byToken1 ? byToken0 : byToken1;
        }

        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mintLp(to, liquidity);

        reserve0 += amount0;
        reserve1 += amount1;
        kLast = reserve0 * reserve1;

        emit Mint(msg.sender, amount0, amount1, liquidity);
        emit Sync(reserve0, reserve1);
    }

    function removeLiquidity(
        uint256 liquidity,
        address to
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) revert InsufficientInput();

        uint256 supply = totalSupply;
        amount0 = (liquidity * reserve0) / supply;
        amount1 = (liquidity * reserve1) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();

        _burnLp(msg.sender, liquidity);

        reserve0 -= amount0;
        reserve1 -= amount1;
        kLast = reserve0 * reserve1;

        IDevoxTransferable(token0).transfer(to, amount0);
        IDevoxTransferable(token1).transfer(to, amount1);

        emit Burn(msg.sender, amount0, amount1, to);
        emit Sync(reserve0, reserve1);
    }

    // ── swap ──────────────────────────────────────────────────────────────

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        if (amountIn == 0) revert InsufficientInput();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (10_000 - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * 10_000 + amountInWithFee);
    }

    /// Quote without touching state, for UIs and agents.
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256) {
        if (tokenIn != token0 && tokenIn != token1) revert InvalidToken();
        (uint256 rIn, uint256 rOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        if (rIn == 0 || rOut == 0) return 0;
        uint256 amountInWithFee = amountIn * (10_000 - FEE_BPS);
        return (amountInWithFee * rOut) / (rIn * 10_000 + amountInWithFee);
    }

    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (tokenIn != token0 && tokenIn != token1) revert InvalidToken();
        if (amountIn == 0) revert InsufficientInput();

        bool zeroForOne = tokenIn == token0;
        (uint256 rIn, uint256 rOut) = zeroForOne ? (reserve0, reserve1) : (reserve1, reserve0);

        amountOut = getAmountOut(amountIn, rIn, rOut);
        if (amountOut < amountOutMin) revert InsufficientOutput();
        if (amountOut >= rOut) revert InsufficientLiquidity();

        address tokenOut = zeroForOne ? token1 : token0;

        IDevoxTransferable(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IDevoxTransferable(tokenOut).transfer(to, amountOut);

        if (zeroForOne) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }
        kLast = reserve0 * reserve1;

        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
        emit Sync(reserve0, reserve1);
    }

    /// Babylonian square root, as used by Uniswap V2 for the first LP mint.
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
