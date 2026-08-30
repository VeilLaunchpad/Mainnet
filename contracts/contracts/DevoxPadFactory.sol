// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DevoxCurve} from "./DevoxCurve.sol";
import {ITokenDeployer} from "./TokenDeployers.sol";

interface ILaunchToken {
    // Void returns so one interface covers OpenZeppelin's ERC20 and COTI's
    // PrivateERC20, which returns nothing.
    function transfer(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external;
    function burn(uint256 amount) external;
}

interface IDevoxLocker {
    function lock(
        address token,
        address beneficiary,
        uint256 amount,
        uint64 unlockAt
    ) external returns (uint256 id);
}

/**
 * @title DevoxPadFactory - one transaction turns an idea into a live market.
 *
 * A launch is a single call. It deploys the curve, deploys the token naming
 * that curve as its only minter, optionally buys on the creator's behalf, and
 * then does whatever the creator chose with that allocation: hand it over,
 * burn part of it, or lock it for a fixed number of days.
 *
 * Both deployments use CREATE2, which is what lets an address be mined in
 * advance. Every DEVOXPAD launch lands on an address ending in 8888.
 */
contract DevoxPadFactory {
    address public owner;
    address public treasury;
    address public locker;

    /// Token creation code lives in these, so this contract stays under 24KB.
    ITokenDeployer public privateDeployer;
    ITokenDeployer public publicDeployer;

    uint256 public launchFee = 0.01 ether;
    uint256 public virtualCoti = 25 ether;
    uint256 public curveSupply = 800_000_000 ether;
    uint256 public poolSupply = 200_000_000 ether;
    uint256 public graduationTarget = 100 ether;
    uint24 public feeTier = 3000;

    /// What a creator can do with the allocation their dev buy produced.
    enum Allocation {
        Keep,
        Burn,
        Lock
    }

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        bool privateBalances;
        bytes32 agentId;
        /// Salts mined off-chain so both addresses are known before the call.
        bytes32 curveSalt;
        bytes32 tokenSalt;
        /// Of msg.value, how much to spend buying on the creator's behalf.
        uint256 devBuy;
        Allocation allocation;
        /// Percent of the dev buy to burn, 0 to 100. Only read for Burn.
        uint8 burnPercent;
        /// Days to hold the dev buy. Only read for Lock.
        uint16 lockDays;
    }

    address[] private _tokens;
    mapping(address => address) public curveOf;
    mapping(address => address[]) public tokensByCreator;
    mapping(address => bytes32) public agentOf;

    /// What happened to each creator's allocation, so a page can show it.
    mapping(address => uint256) public burnedOf;
    mapping(address => uint256) public devBoughtOf;

    event Launched(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI
    );
    event DevBuy(address indexed token, address indexed creator, uint256 cotiIn, uint256 tokensOut);
    event AllocationBurned(address indexed token, address indexed creator, uint256 amount, uint8 percent);
    event AllocationLocked(address indexed token, address indexed creator, uint256 amount, uint64 unlockAt);
    event ParamsUpdated(
        uint256 virtualCoti,
        uint256 curveSupply,
        uint256 poolSupply,
        uint256 graduationTarget,
        uint24 feeTier
    );

    error NotOwner();
    error FeeTooLow();
    error TransferFailed();
    error BadBurnPercent();
    error BadLockDays();
    error NoLocker();
    error NoDevBuy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address treasury_,
        address privateDeployer_,
        address publicDeployer_,
        address locker_
    ) {
        owner = msg.sender;
        treasury = treasury_ == address(0) ? msg.sender : treasury_;
        privateDeployer = ITokenDeployer(privateDeployer_);
        publicDeployer = ITokenDeployer(publicDeployer_);
        locker = locker_;
    }

    // ── launching ─────────────────────────────────────────────────────────

    function launch(LaunchParams calldata p) external payable returns (address token, address curve) {
        if (msg.value < launchFee + p.devBuy) revert FeeTooLow();

        _validate(p);

        // Curve first, token second. The token names the curve as its sole
        // minter in its own constructor, so there is never a moment where any
        // other address could create supply.
        curve = address(
            new DevoxCurve{salt: p.curveSalt}(
                msg.sender,
                virtualCoti,
                curveSupply,
                poolSupply,
                graduationTarget,
                feeTier
            )
        );

        ITokenDeployer deployer = p.privateBalances ? privateDeployer : publicDeployer;
        token = deployer.deploy(p.tokenSalt, p.name, p.symbol, p.metadataURI, msg.sender, curve);

        DevoxCurve(payable(curve)).initialize(token);

        _tokens.push(token);
        curveOf[token] = curve;
        tokensByCreator[msg.sender].push(token);
        if (p.agentId != bytes32(0)) agentOf[token] = p.agentId;

        emit Launched(token, curve, msg.sender, p.name, p.symbol, p.metadataURI);

        if (p.devBuy > 0) _devBuy(token, curve, p);

        uint256 fee = msg.value - p.devBuy;
        if (fee > 0) {
            (bool ok, ) = treasury.call{value: fee}("");
            if (!ok) revert TransferFailed();
        }
    }

    function _validate(LaunchParams calldata p) internal view {
        if (p.allocation == Allocation.Burn) {
            if (p.burnPercent > 100) revert BadBurnPercent();
            if (p.devBuy == 0) revert NoDevBuy();
        }
        if (p.allocation == Allocation.Lock) {
            if (p.lockDays == 0 || p.lockDays > 3650) revert BadLockDays();
            if (p.devBuy == 0) revert NoDevBuy();
            if (locker == address(0)) revert NoLocker();
        }
    }

    /**
     * Buys on the creator's behalf, then applies what they chose.
     *
     * The tokens land here first so the factory can burn or lock part of them
     * before the creator ever holds them. A creator who picked "burn 50" cannot
     * take delivery and then not burn.
     */
    function _devBuy(address token, address curve, LaunchParams calldata p) internal {
        uint256 bought = DevoxCurve(payable(curve)).buy{value: p.devBuy}(0);
        devBoughtOf[token] = bought;
        emit DevBuy(token, msg.sender, p.devBuy, bought);

        if (p.allocation == Allocation.Burn) {
            uint256 toBurn = (bought * p.burnPercent) / 100;
            if (toBurn > 0) {
                ILaunchToken(token).burn(toBurn);
                burnedOf[token] = toBurn;
                emit AllocationBurned(token, msg.sender, toBurn, p.burnPercent);
            }
            uint256 rest = bought - toBurn;
            if (rest > 0) ILaunchToken(token).transfer(msg.sender, rest);
            return;
        }

        if (p.allocation == Allocation.Lock) {
            uint64 unlockAt = uint64(block.timestamp + uint256(p.lockDays) * 1 days);
            ILaunchToken(token).approve(locker, bought);
            IDevoxLocker(locker).lock(token, msg.sender, bought, unlockAt);
            emit AllocationLocked(token, msg.sender, bought, unlockAt);
            return;
        }

        ILaunchToken(token).transfer(msg.sender, bought);
    }

    // ── address prediction, for mining a salt off-chain ───────────────────

    /**
     * Where a curve with this salt would land. The client needs it before it
     * can mine the token salt, because the curve address is one of the token's
     * constructor arguments.
     */
    function predictCurve(address creator, bytes32 salt) public view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(DevoxCurve).creationCode,
                abi.encode(creator, virtualCoti, curveSupply, poolSupply, graduationTarget, feeTier)
            )
        );
        return
            address(
                uint160(
                    uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))
                )
            );
    }

    /// The init code hash the client hashes against while mining.
    function tokenInitCodeHash(
        bool privateBalances,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        address creator,
        address curve
    ) external view returns (bytes32) {
        ITokenDeployer d = privateBalances ? privateDeployer : publicDeployer;
        return d.initCodeHash(name, symbol, metadataURI, creator, curve);
    }

    function deployerFor(bool privateBalances) external view returns (address) {
        return address(privateBalances ? privateDeployer : publicDeployer);
    }

    // ── views ─────────────────────────────────────────────────────────────

    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _tokens[index];
    }

    function tokensOf(address creator) external view returns (address[] memory) {
        return tokensByCreator[creator];
    }

    function page(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 total = _tokens.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        out = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) out[i - offset] = _tokens[i];
    }

    /// Fixed total supply of every launch: what the curve sells plus the pool seed.
    function totalSupplyPerLaunch() external view returns (uint256) {
        return curveSupply + poolSupply;
    }

    // ── admin ─────────────────────────────────────────────────────────────

    function setParams(
        uint256 virtualCoti_,
        uint256 curveSupply_,
        uint256 poolSupply_,
        uint256 graduationTarget_,
        uint24 feeTier_
    ) external onlyOwner {
        virtualCoti = virtualCoti_;
        curveSupply = curveSupply_;
        poolSupply = poolSupply_;
        graduationTarget = graduationTarget_;
        feeTier = feeTier_;
        emit ParamsUpdated(virtualCoti_, curveSupply_, poolSupply_, graduationTarget_, feeTier_);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        launchFee = fee;
    }

    function setTreasury(address t) external onlyOwner {
        treasury = t;
    }

    function setLocker(address l) external onlyOwner {
        locker = l;
    }

    function setDeployers(address privateDeployer_, address publicDeployer_) external onlyOwner {
        privateDeployer = ITokenDeployer(privateDeployer_);
        publicDeployer = ITokenDeployer(publicDeployer_);
    }

    function transferOwnership(address to) external onlyOwner {
        owner = to;
    }

    /// Finishes graduation for a curve that froze before a DEX existed here.
    /**
     * Where a graduating curve sends its raise.
     *
     * Held here, as protocol configuration, because the curve must not take it
     * from whoever calls `graduate` - that let any caller name the destination
     * of the entire reserve. Set once at deployment; changing it only affects
     * launches that have not graduated yet.
     */
    address public swapFactory;
    address public wcoti;

    event DexSet(address swapFactory, address wcoti);

    function setDex(address swapFactory_, address wcoti_) external onlyOwner {
        swapFactory = swapFactory_;
        wcoti = wcoti_;
        emit DexSet(swapFactory_, wcoti_);
    }

    /// Finishes a graduation that froze because no DEX was configured yet.
    function seedPool(address curve) external onlyOwner returns (address) {
        return DevoxCurve(payable(curve)).seedPool();
    }

    /// The curve pays the dev buy out to this contract, so it must accept COTI.
    receive() external payable {}
}
