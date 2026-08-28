// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProfileRegistry - usernames that resolve on-chain.
 *
 * /profile/{username} reads from here. One handle per address, first come
 * first served, and the handle belongs to the address rather than to us.
 */
contract ProfileRegistry {
    mapping(bytes32 => address) private _byName;
    mapping(address => string) public usernameOf;
    mapping(address => string) public metadataOf;

    uint256 public claimFee;
    address public owner;

    event Claimed(address indexed account, string username);
    event MetadataUpdated(address indexed account, string metadataURI);

    error NameTaken();
    error NameInvalid();
    error FeeTooLow();
    error NotOwner();

    constructor() {
        owner = msg.sender;
    }

    function _key(string memory name) internal pure returns (bytes32) {
        return keccak256(bytes(_lower(name)));
    }

    // ASCII lowercase so "Alice" and "alice" cannot both be claimed.
    function _lower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return string(b);
    }

    function _valid(string memory name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < 3 || b.length > 32) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                (c >= 0x41 && c <= 0x5A) ||
                (c >= 0x61 && c <= 0x7A) ||
                c == 0x5F ||
                c == 0x2D;
            if (!ok) return false;
        }
        return true;
    }

    function claim(string calldata username, string calldata metadataURI) external payable {
        if (msg.value < claimFee) revert FeeTooLow();
        if (!_valid(username)) revert NameInvalid();

        bytes32 key = _key(username);
        address holder = _byName[key];
        if (holder != address(0) && holder != msg.sender) revert NameTaken();

        // Release the caller's previous handle so it does not linger reserved.
        string memory previous = usernameOf[msg.sender];
        if (bytes(previous).length != 0) delete _byName[_key(previous)];

        _byName[key] = msg.sender;
        usernameOf[msg.sender] = username;
        metadataOf[msg.sender] = metadataURI;

        emit Claimed(msg.sender, username);
    }

    function setMetadata(string calldata metadataURI) external {
        metadataOf[msg.sender] = metadataURI;
        emit MetadataUpdated(msg.sender, metadataURI);
    }

    function addressOf(string calldata username) external view returns (address) {
        return _byName[_key(username)];
    }

    function setClaimFee(uint256 fee) external {
        if (msg.sender != owner) revert NotOwner();
        claimFee = fee;
    }

    function withdraw(address to) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}
