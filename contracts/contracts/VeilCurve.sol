// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWCOTI, IVeilMintable} from "./interfaces/IUniswapV3.sol";
import {VeilSwapFactory} from "./VeilSwapFactory.sol";
import {VeilSwapPair} from "./VeilSwapPair.sol";

/**
 * @title VeilCurve - the bonding curve a VEILPAD launch lives on until it graduates.
 *
 * Pricing is a constant-product curve over *virtual* reserves, so the very
 * first buyer does not need a counterparty and price rises smoothly with
 * demand:
 *
 *     k = virtualCoti * curveSupply
 *     tokensOut = tokenReserve - k / (cotiReserve + cotiIn)
 *
 * The curve mints on buy and burns on sell. It never holds a token balance,
 * which matters: on a private token its own balance would be ciphertext it
 * cannot read, so accounting that depended on `balanceOf` would be unusable.
 *
 * When real COTI raised reaches `graduationTarget`, trading on the curve stops
 * and `graduate()` moves everything into a Uniswap V3 pool.
 */
contract VeilCurve is ReentrancyGuard {
    // ── configuration ────────────────────────────────────────────────────
    /// Set once by the factory immediately after deployment. The curve is
    /// deployed before its token so the token can name it as sole minter in
    /// its own constructor - no role handoff, no window where anyone else
    /// could mint.
    address public token;

    address public immutable creator;
    address public immutable factory;

    uint256 public immutable virtualCoti;
    uint256 public immutable curveSupply;
    uint256 public immutable poolSupply;
    uint256 public immutable graduationTarget;
    uint24 public immutable feeTier;

    // ── mutable state ────────────────────────────────────────────────────
    uint256 public reserve;      // real COTI raised
    uint256 public sold;         // tokens minted through the curve
    bool public graduated;
    address public pool;

    /// Basis points taken from every trade and paid to the creator on graduation.
    uint16 public constant TRADE_FEE_BPS = 100; // 1%
    uint256 public accruedFees;

    event Traded(address indexed trader, bool isBuy, uint256 cotiAmount, uint256 tokenAmount, uint256 newPrice);
    event Graduated(address indexed pool, uint256 cotiLiquidity, uint256 tokenLiquidity);
    event FeesPaid(address indexed to, uint256 amount);

    error AlreadyGraduated();
    error NotGraduated();
    error TargetNotReached();
    error ZeroAmount();
    error Slippage();
    error TransferFailed();
    error PoolAlreadySeeded();
    error NotFactory();
    error AlreadyInitialized();
    error NotInitialized();

    constructor(
        address creator_,
        uint256 virtualCoti_,
        uint256 curveSupply_,
        uint256 poolSupply_,
        uint256 graduationTarget_,
        uint24 feeTier_
    ) {
        creator = creator_;
        factory = msg.sender;
        virtualCoti = virtualCoti_;
        curveSupply = curveSupply_;
        poolSupply = poolSupply_;
        graduationTarget = graduationTarget_;
        feeTier = feeTier_;
    }

    function initialize(address token_) external {
        if (msg.sender != factory) revert NotFactory();
        if (token != address(0)) revert AlreadyInitialized();
        token = token_;
    }

    // ── pricing ──────────────────────────────────────────────────────────

    function _tokenReserve() internal view returns (uint256) {
        return curveSupply - sold;
    }

    function _k() internal view returns (uint256) {
        return virtualCoti * curveSupply;
    }

    /// Marginal price in wei of COTI per whole token, scaled to 1e18.
    function spotPrice() public view returns (uint256) {
        uint256 tr = _tokenReserve();
        if (tr == 0) return type(uint256).max;
        return ((virtualCoti + reserve) * 1e18) / tr;
    }

    function quoteBuy(uint256 cotiIn) public view returns (uint256 tokensOut) {
        if (cotiIn == 0 || graduated) return 0;
        uint256 net = cotiIn - (cotiIn * TRADE_FEE_BPS) / 10_000;
        uint256 newCoti = virtualCoti + reserve + net;
        uint256 newTokenReserve = _k() / newCoti;
        uint256 tr = _tokenReserve();
        tokensOut = tr > newTokenReserve ? tr - newTokenReserve : 0;
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 cotiOut) {
        if (tokensIn == 0 || graduated || tokensIn > sold) return 0;
        uint256 newTokenReserve = _tokenReserve() + tokensIn;
        uint256 newCoti = _k() / newTokenReserve;
        uint256 current = virtualCoti + reserve;
        if (newCoti >= current) return 0;
        uint256 gross = current - newCoti;
        cotiOut = gross - (gross * TRADE_FEE_BPS) / 10_000;
    }

    /// Percentage of the way to graduation, in basis points.
    function progressBps() external view returns (uint256) {
        if (graduationTarget == 0) return 0;
        uint256 p = (reserve * 10_000) / graduationTarget;
        return p > 10_000 ? 10_000 : p;
    }

    // ── trading ──────────────────────────────────────────────────────────

    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (graduated) revert AlreadyGraduated();
        if (token == address(0)) revert NotInitialized();
        if (msg.value == 0) revert ZeroAmount();

        uint256 fee = (msg.value * TRADE_FEE_BPS) / 10_000;
        uint256 net = msg.value - fee;

        tokensOut = quoteBuy(msg.value);
        if (tokensOut == 0) revert ZeroAmount();
        if (tokensOut < minTokensOut) revert Slippage();

        reserve += net;
        accruedFees += fee;
        sold += tokensOut;

        IVeilMintable(token).mint(msg.sender, tokensOut);

        emit Traded(msg.sender, true, msg.value, tokensOut, spotPrice());
    }

    /**
     * Sell back into the curve. The seller approves this contract first; we
     * pull the tokens and burn them, so supply always matches `sold`.
     */
    function sell(uint256 tokensIn, uint256 minCotiOut) external nonReentrant returns (uint256 cotiOut) {
        if (graduated) revert AlreadyGraduated();
        if (tokensIn == 0) revert ZeroAmount();

        cotiOut = quoteSell(tokensIn);
        if (cotiOut == 0) revert ZeroAmount();
        if (cotiOut < minCotiOut) revert Slippage();

        uint256 newTokenReserve = _tokenReserve() + tokensIn;
        uint256 gross = (virtualCoti + reserve) - (_k() / newTokenReserve);
        uint256 fee = gross - cotiOut;

        sold -= tokensIn;
        reserve -= gross;
        accruedFees += fee;

        IVeilMintable(token).transferFrom(msg.sender, address(this), tokensIn);
        IVeilMintable(token).burn(tokensIn);

        (bool ok, ) = msg.sender.call{value: cotiOut}("");
        if (!ok) revert TransferFailed();

        emit Traded(msg.sender, false, cotiOut, tokensIn, spotPrice());
    }

    // ── graduation ───────────────────────────────────────────────────────

    /**
     * Permissionless once the target is hit. Freezes the curve, mints the pool
     * allocation, and moves the entire reserve into a VeilSwap pair.
     *
     * If no swap factory is configured on this network the curve still freezes
     * and holds the reserve, so `seedPool` can finish the job later rather than
     * trapping the raise behind an address that does not exist yet.
     */
    function graduate(address swapFactory, address wcoti) external nonReentrant returns (address) {
        if (graduated) revert AlreadyGraduated();
        if (reserve < graduationTarget) revert TargetNotReached();

        graduated = true;

        uint256 cotiLiquidity = reserve;
        reserve = 0;

        _payCreatorFees();

        if (swapFactory == address(0) || wcoti == address(0)) {
            emit Graduated(address(0), cotiLiquidity, poolSupply);
            return address(0);
        }

        pool = _seed(swapFactory, wcoti, cotiLiquidity);
        emit Graduated(pool, cotiLiquidity, poolSupply);
        return pool;
    }

    /// Finishes a graduation that froze before a DEX existed on this network.
    function seedPool(address swapFactory, address wcoti) external nonReentrant returns (address) {
        if (msg.sender != factory) revert NotFactory();
        if (!graduated) revert NotGraduated();
        if (pool != address(0)) revert PoolAlreadySeeded();

        uint256 cotiLiquidity = address(this).balance - accruedFees;
        pool = _seed(swapFactory, wcoti, cotiLiquidity);
        emit Graduated(pool, cotiLiquidity, poolSupply);
        return pool;
    }

    function _seed(
        address swapFactory,
        address wcoti,
        uint256 cotiLiquidity
    ) internal returns (address created) {
        created = VeilSwapFactory(swapFactory).getPair(token, wcoti);
        if (created == address(0)) {
            created = VeilSwapFactory(swapFactory).createPair(token, wcoti);
        }

        IWCOTI(wcoti).deposit{value: cotiLiquidity}();
        IVeilMintable(token).mint(address(this), poolSupply);

        // The pair pulls what it needs, so it must be allowed to.
        IWCOTI(wcoti).approve(created, cotiLiquidity);
        IVeilMintable(token).approve(created, poolSupply);

        VeilSwapPair pair = VeilSwapPair(created);
        (uint256 amount0, uint256 amount1) = pair.token0() == token
            ? (poolSupply, cotiLiquidity)
            : (cotiLiquidity, poolSupply);

        // LP shares are minted to this contract, which has no function that can
        // transfer or burn them. Launch liquidity is locked, not "locked".
        pair.addLiquidity(amount0, amount1, address(this));
    }

    function _payCreatorFees() internal {
        uint256 fees = accruedFees;
        if (fees == 0) return;
        accruedFees = 0;
        (bool ok, ) = creator.call{value: fees}("");
        if (ok) emit FeesPaid(creator, fees);
        else accruedFees = fees;
    }

    /// Creator can sweep accrued trading fees at any time.
    function claimFees() external nonReentrant {
        _payCreatorFees();
    }

    receive() external payable {}
}
