// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * A minimal ERC-721, for tests only.
 *
 * Not OpenZeppelin's: theirs reaches Strings and Bytes, which compile to
 * `mcopy` - a Cancun instruction that COTI's Paris-target gcVM cannot run.
 * COTI's own PrivateERC721 avoids that, which is why the real drop uses it.
 *
 * Staking touches a collection through ownerOf, transferFrom and approval and
 * nothing else, so this implements exactly that and no more.
 */
contract MockERC721 {
    string public name;
    string public symbol;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "no such token");
        return o;
    }

    function balanceOf(address who) external view returns (uint256) {
        return _balances[who];
    }

    function mint(address to, uint256 tokenId) external {
        require(_owners[tokenId] == address(0), "already minted");
        _owners[tokenId] = to;
        _balances[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "not the owner");
        _tokenApprovals[tokenId] = to;
        emit Approval(msg.sender, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(ownerOf(tokenId) == from, "not the owner");
        require(
            msg.sender == from || isApprovedForAll(from, msg.sender) || _tokenApprovals[tokenId] == msg.sender,
            "not approved"
        );
        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x80ac58cd || id == 0x01ffc9a7; // ERC721, ERC165
    }
}
