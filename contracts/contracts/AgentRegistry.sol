// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistry - on-chain identity for a tokenized agent.
 *
 * An agent's brain runs off-chain; what belongs on-chain is who owns it, which
 * wallet it acts through, and which token represents it. That triple is what
 * lets one agent verify another before transacting with it.
 */
contract AgentRegistry {
    struct Agent {
        address owner;
        address agentWallet;
        address token;
        string slug;
        string metadataURI;
        uint64 createdAt;
    }

    mapping(bytes32 => Agent) private _agents;
    mapping(bytes32 => bytes32) private _idBySlug;
    bytes32[] private _ids;

    uint256 public registrationFee;
    address public owner;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, address indexed agentWallet, string slug);
    event AgentUpdated(bytes32 indexed agentId, address agentWallet, address token, string metadataURI);
    event AgentTransferred(bytes32 indexed agentId, address indexed from, address indexed to);

    error SlugTaken();
    error SlugInvalid();
    error NotAgentOwner();
    error FeeTooLow();
    error NotOwner();
    error UnknownAgent();

    constructor() {
        owner = msg.sender;
    }

    function _slugKey(string memory slug) internal pure returns (bytes32) {
        return keccak256(bytes(slug));
    }

    function register(
        string calldata slug,
        string calldata metadataURI,
        address agentWallet,
        address token
    ) external payable returns (bytes32 agentId) {
        if (msg.value < registrationFee) revert FeeTooLow();
        if (bytes(slug).length < 2 || bytes(slug).length > 32) revert SlugInvalid();

        bytes32 slugKey = _slugKey(slug);
        if (_idBySlug[slugKey] != bytes32(0)) revert SlugTaken();

        agentId = keccak256(abi.encodePacked(msg.sender, slug, block.chainid, _ids.length));

        _agents[agentId] = Agent({
            owner: msg.sender,
            agentWallet: agentWallet,
            token: token,
            slug: slug,
            metadataURI: metadataURI,
            createdAt: uint64(block.timestamp)
        });
        _idBySlug[slugKey] = agentId;
        _ids.push(agentId);

        emit AgentRegistered(agentId, msg.sender, agentWallet, slug);
    }

    function update(
        bytes32 agentId,
        address agentWallet,
        address token,
        string calldata metadataURI
    ) external {
        Agent storage a = _agents[agentId];
        if (a.owner == address(0)) revert UnknownAgent();
        if (a.owner != msg.sender) revert NotAgentOwner();

        a.agentWallet = agentWallet;
        a.token = token;
        a.metadataURI = metadataURI;

        emit AgentUpdated(agentId, agentWallet, token, metadataURI);
    }

    /// Agents are transferable - that is what makes "tokenize an agent" mean something.
    function transferAgent(bytes32 agentId, address to) external {
        Agent storage a = _agents[agentId];
        if (a.owner != msg.sender) revert NotAgentOwner();
        a.owner = to;
        emit AgentTransferred(agentId, msg.sender, to);
    }

    function agentOf(bytes32 agentId)
        external
        view
        returns (address, address, address, string memory, string memory, uint64)
    {
        Agent storage a = _agents[agentId];
        return (a.owner, a.agentWallet, a.token, a.slug, a.metadataURI, a.createdAt);
    }

    function idBySlug(string calldata slug) external view returns (bytes32) {
        return _idBySlug[_slugKey(slug)];
    }

    function agentCount() external view returns (uint256) {
        return _ids.length;
    }

    function agentAt(uint256 index) external view returns (bytes32) {
        return _ids[index];
    }

    function setRegistrationFee(uint256 fee) external {
        if (msg.sender != owner) revert NotOwner();
        registrationFee = fee;
    }

    function withdraw(address to) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}
