// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrivateERC20} from "@coti-io/coti-contracts/contracts/token/PrivateERC20/PrivateERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPortalERC20 {
    // Void returns so one interface covers OpenZeppelin's ERC20 (returns bool)
    // and COTI's PrivateERC20 (returns nothing).
    function transferFrom(address from, address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IPortalMintable {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function transferFrom(address from, address to, uint256 amount) external;
}

/**
 * @title DevoxPortalToken - the private twin of a public token.
 *
 * A one-to-one shielded representation. Decimals are copied from the source
 * rather than hardcoded, because a 6-decimal stablecoin wrapped into an
 * 18-decimal twin would silently misprice by a factor of a trillion.
 *
 * Only the portal can mint or burn, and the portal is set at construction, so
 * the supply of a twin is always exactly what the portal has locked.
 */
contract DevoxPortalToken is PrivateERC20 {
    uint8 private immutable _decimals;

    /// The public token held in escrow behind this twin. Zero means native COTI.
    address public immutable underlying;
    address public immutable portal;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address underlying_,
        address portal_
    ) PrivateERC20(name_, symbol_) {
        _decimals = decimals_;
        underlying = underlying_;
        portal = portal_;
        _grantRole(MINTER_ROLE, portal_);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}

/**
 * Twin creation code lives here so the portal stays under the 24KB deployment
 * limit. The deployer renounces the admin role it inherits in the same
 * transaction, which freezes the twin's roles: the portal can mint, and nobody
 * can ever grant that right to anyone else.
 */
contract PortalTokenDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        uint8 decimals_,
        address underlying,
        address portal
    ) external returns (address token) {
        DevoxPortalToken t = new DevoxPortalToken(name, symbol, decimals_, underlying, portal);
        t.renounceRole(0x00, address(this)); // DEFAULT_ADMIN_ROLE
        token = address(t);
    }
}

interface IPortalTokenDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        uint8 decimals_,
        address underlying,
        address portal
    ) external returns (address token);
}

/**
 * @title DevoxPortal - move value between the public and the private side.
 *
 * Wrapping locks a public token here and mints its private twin one to one.
 * Unwrapping burns the twin and releases the escrow. The private side is a COTI
 * PrivateERC20, so balances become ciphertext the moment they cross.
 *
 * What crossing does and does not buy you, stated plainly: the wrap and unwrap
 * transactions are public, and their amounts are visible. What becomes private
 * is everything that happens while the value stays on the private side, and how
 * much of it any given address holds.
 */
contract DevoxPortal is ReentrancyGuard {
    IPortalTokenDeployer public immutable deployer;

    /// Public token to its private twin, and the reverse.
    mapping(address => address) public twinOf;
    mapping(address => address) public underlyingOf;

    /// How much of each public token this contract holds in escrow.
    mapping(address => uint256) public locked;

    address[] private _twins;

    /// Native COTI has no ERC-20 to point at, so it uses this sentinel.
    address public constant NATIVE = address(0);

    event TwinCreated(address indexed underlying, address indexed twin, string symbol);
    event Wrapped(address indexed account, address indexed underlying, address indexed twin, uint256 amount);
    event Unwrapped(address indexed account, address indexed underlying, address indexed twin, uint256 amount);

    error ZeroAmount();
    error NoTwin();
    error TransferFailed();
    error NotWrappable();

    constructor(address deployer_) {
        deployer = IPortalTokenDeployer(deployer_);
    }

    // ── views ─────────────────────────────────────────────────────────────

    function twinCount() external view returns (uint256) {
        return _twins.length;
    }

    function twinAt(uint256 index) external view returns (address) {
        return _twins[index];
    }

    function allTwins() external view returns (address[] memory) {
        return _twins;
    }

    /// The private twin for a public token, creating nothing. Zero if none yet.
    function privateOf(address publicToken) external view returns (address) {
        return twinOf[publicToken];
    }

    // ── into privacy ──────────────────────────────────────────────────────

    /**
     * Locks `amount` of a public ERC-20 and mints the same amount of its twin.
     * The twin is created on first use, so any ERC-20 can be portalled without
     * an admin listing it first.
     */
    function wrap(address publicToken, uint256 amount) external nonReentrant returns (address twin) {
        if (amount == 0) revert ZeroAmount();
        if (publicToken == NATIVE) revert NotWrappable();

        twin = twinOf[publicToken];
        if (twin == address(0)) twin = _createTwin(publicToken);

        IPortalERC20(publicToken).transferFrom(msg.sender, address(this), amount);
        locked[publicToken] += amount;
        IPortalMintable(twin).mint(msg.sender, amount);

        emit Wrapped(msg.sender, publicToken, twin, amount);
    }

    /// Same for native COTI, which has no ERC-20 to pull from.
    function wrapNative() external payable nonReentrant returns (address twin) {
        if (msg.value == 0) revert ZeroAmount();

        twin = twinOf[NATIVE];
        if (twin == address(0)) twin = _createNativeTwin();

        locked[NATIVE] += msg.value;
        IPortalMintable(twin).mint(msg.sender, msg.value);

        emit Wrapped(msg.sender, NATIVE, twin, msg.value);
    }

    // ── back out ──────────────────────────────────────────────────────────

    /**
     * Burns `amount` of the twin and returns the escrowed public token. The
     * caller approves this contract on the twin first.
     */
    function unwrap(address publicToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address twin = twinOf[publicToken];
        if (twin == address(0)) revert NoTwin();

        IPortalMintable(twin).transferFrom(msg.sender, address(this), amount);
        IPortalMintable(twin).burn(amount);
        locked[publicToken] -= amount;

        IPortalERC20(publicToken).transfer(msg.sender, amount);

        emit Unwrapped(msg.sender, publicToken, twin, amount);
    }

    function unwrapNative(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address twin = twinOf[NATIVE];
        if (twin == address(0)) revert NoTwin();

        IPortalMintable(twin).transferFrom(msg.sender, address(this), amount);
        IPortalMintable(twin).burn(amount);
        locked[NATIVE] -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Unwrapped(msg.sender, NATIVE, twin, amount);
    }

    // ── twin creation ─────────────────────────────────────────────────────

    function _createTwin(address publicToken) internal returns (address twin) {
        string memory sym = IPortalERC20(publicToken).symbol();
        string memory nm = IPortalERC20(publicToken).name();
        uint8 dec = IPortalERC20(publicToken).decimals();

        twin = deployer.deploy(
            string.concat("Private ", nm),
            string.concat("p", sym),
            dec,
            publicToken,
            address(this)
        );

        twinOf[publicToken] = twin;
        underlyingOf[twin] = publicToken;
        _twins.push(twin);

        emit TwinCreated(publicToken, twin, string.concat("p", sym));
    }

    function _createNativeTwin() internal returns (address twin) {
        twin = deployer.deploy("Private COTI", "pCOTI", 18, NATIVE, address(this));

        twinOf[NATIVE] = twin;
        underlyingOf[twin] = NATIVE;
        _twins.push(twin);

        emit TwinCreated(NATIVE, twin, "pCOTI");
    }

    /// Only accepted from an unwrap flow; there is nothing to credit otherwise.
    receive() external payable {
        revert NotWrappable();
    }
}
