/**
 * ABIs are hand-written fragments (not full artifacts) so the bundle stays
 * small and every call site is legible.
 *
 * COTI privacy types over the wire:
 *   ctUint256  -> uint256 ciphertext stored on-chain
 *   itUint256  -> (uint256 ciphertext, bytes signature) input struct
 *   ctString   -> (ctUint256[3] value) chunked string ciphertext
 */

export const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    // The cross-chain bridge is a plain transfer to a watched recipient, so
    // this is the whole of that protocol on the token side.
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** COTI PrivateERC20 - encrypted balances, public routing. */
export const privateErc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    /**
     * A ctUint256 is TWO words, and declaring it as one is a silent corruption
     * rather than an error: ethers happily decodes the first word, the SDK
     * happily "decrypts" half a ciphertext, and the result is a plausible
     * number - usually 0. A wrapped balance then reads as empty, which looks
     * exactly like the wrap having taken the tokens and credited nothing.
     */
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "ciphertextHigh", type: "uint256" },
          { name: "ciphertextLow", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "setAccountEncryptionAddress",
    stateMutability: "nonpayable",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "publicAmountsEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "senderValue", type: "uint256", indexed: false },
      { name: "receiverValue", type: "uint256", indexed: false },
    ],
  },
] as const;

/** COTI PrivateMessaging - on-chain E2E encrypted agent mail. */
export const privateMessagingAbi = [
  /**
   * The cell arrays are dynamic, not fixed at three.
   *
   * This was written as `uint256[3]` and `bytes[3]`, which made ethers demand
   * exactly three cells and reject anything else with "array is wrong length".
   * The deployed contract takes `uint256[]` and allows one to three cells per
   * chunk, so short messages were failing for a reason that had nothing to do
   * with them.
   */
  {
    type: "function",
    name: "sendMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      {
        name: "encryptedMessage",
        type: "tuple",
        components: [
          {
            name: "ciphertext",
            type: "tuple",
            components: [{ name: "value", type: "uint256[]" }],
          },
          { name: "signature", type: "bytes[]" },
        ],
      },
    ],
    outputs: [{ name: "messageId", type: "uint256" }],
  },
  /**
   * Anything longer than one chunk goes here. A chunk holds at most three
   * 64-bit cells, so 24 bytes, and a message may carry up to 64 chunks.
   */
  {
    type: "function",
    name: "sendMultipartMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      {
        name: "encryptedChunks",
        type: "tuple[]",
        components: [
          {
            name: "ciphertext",
            type: "tuple",
            components: [{ name: "value", type: "uint256[]" }],
          },
          { name: "signature", type: "bytes[]" },
        ],
      },
    ],
    outputs: [{ name: "messageId", type: "uint256" }],
  },
  {
    type: "function",
    name: "inboxCount",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sentCount",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getInboxPage",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getSentPage",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getMessageMetadata",
    stateMutability: "view",
    inputs: [{ name: "messageId", type: "uint256" }],
    outputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "timestamp", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "chunkCount", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "epochUsageUnits",
    stateMutability: "view",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "MessageSent",
    inputs: [
      { name: "messageId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "epoch", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * DEVOXPAD launchpad.
 *
 * One call does everything: deploys the curve and the token with CREATE2 at
 * addresses mined in advance, optionally buys on the creator's behalf, and then
 * keeps, burns or locks that allocation. The salts come from the client, which
 * is what makes an address ending in 8888 possible.
 */
export const devoxFactoryAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "metadataURI", type: "string" },
          { name: "privateBalances", type: "bool" },
          { name: "agentId", type: "bytes32" },
          { name: "curveSalt", type: "bytes32" },
          { name: "tokenSalt", type: "bytes32" },
          { name: "devBuy", type: "uint256" },
          { name: "allocation", type: "uint8" },
          { name: "burnPercent", type: "uint8" },
          { name: "lockDays", type: "uint16" },
        ],
      },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
    ],
  },
  {
    type: "function",
    name: "predictCurve",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tokenInitCodeHash",
    stateMutability: "view",
    inputs: [
      { name: "privateBalances", type: "bool" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "creator", type: "address" },
      { name: "curve", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "deployerFor",
    stateMutability: "view",
    inputs: [{ name: "privateBalances", type: "bool" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "totalSupplyPerLaunch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "virtualCoti", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "curveSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "graduationTarget",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "locker", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "tokenAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "curveOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "burnedOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "devBoughtOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Launched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "curve", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DevBuy",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "cotiIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationBurned",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "percent", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationLocked",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "unlockAt", type: "uint64", indexed: false },
    ],
  },
] as const;

export const devoxLockerAbi = [
  {
    type: "function",
    name: "lockAt",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "unlockAt", type: "uint64" },
      { name: "claimed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "locksForToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "locksForBeneficiary",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "lockedOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const devoxCurveAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "reserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "pool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "graduationTarget",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "spotPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "quoteBuy",
    stateMutability: "view",
    inputs: [{ name: "cotiIn", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteSell",
    stateMutability: "view",
    inputs: [{ name: "tokensIn", type: "uint256" }],
    outputs: [{ name: "cotiOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "minTokensOut", type: "uint256" }],
    outputs: [{ name: "tokensOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokensIn", type: "uint256" },
      { name: "minCotiOut", type: "uint256" },
    ],
    outputs: [{ name: "cotiOut", type: "uint256" }],
  },
  { type: "function", name: "graduate", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "Traded",
    inputs: [
      { name: "trader", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: false },
      { name: "cotiAmount", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "newPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { name: "pool", type: "address", indexed: true },
      { name: "cotiLiquidity", type: "uint256", indexed: false },
      { name: "tokenLiquidity", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Uniswap V3 - the pool every graduated launch lands in. */
export const univ3FactoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ type: "address" }],
  },
] as const;

export const univ3PoolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
] as const;

export const univ3RouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const univ3QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const univ3PositionManagerAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

export const wcotiAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  ...erc20Abi,
] as const;

/** DEVOXPAD agent registry - tokenized agents with on-chain identity. */
export const agentRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "slug", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "agentWallet", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "agentId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "agentOf",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "bytes32" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "agentWallet", type: "address" },
      { name: "token", type: "address" },
      { name: "slug", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "createdAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "idBySlug",
    stateMutability: "view",
    inputs: [{ name: "slug", type: "string" }],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "agentCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "agentAt",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agentId", type: "bytes32", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentWallet", type: "address", indexed: true },
      { name: "slug", type: "string", indexed: false },
    ],
  },
] as const;

/** DEVOXPAD profiles - username -> address, resolved at /profile/{username}. */
export const profileRegistryAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "payable",
    inputs: [
      { name: "username", type: "string" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setMetadata",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "addressOf",
    stateMutability: "view",
    inputs: [{ name: "username", type: "string" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "usernameOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "metadataOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "username", type: "string", indexed: false },
    ],
  },
] as const;

export const accountOnboardAbi = [
  {
    type: "function",
    name: "onboardAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publicKey", type: "bytes" },
      { name: "signedEK", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "AccountOnboarded",
    inputs: [
      { name: "_from", type: "address", indexed: true },
      { name: "userKey1", type: "bytes", indexed: false },
      { name: "userKey2", type: "bytes", indexed: false },
    ],
  },
] as const;

/**
 * DevoxSwap - the DEX graduated launches land in.
 *
 * A pair keeps its reserves in its own storage instead of deriving them from
 * `balanceOf`, because on a COTI PrivateERC20 `balanceOf` returns a ciphertext
 * handle rather than a number. Reading `reserve0`/`reserve1` here is reading
 * the pair's own books, which is the only thing that can be true for a token
 * whose balances are encrypted.
 */
export const devoxSwapFactoryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "createPair",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "allPairsLength", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allPairs",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "PairCreated",
    inputs: [
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "pair", type: "address", indexed: false },
      { name: "index", type: "uint256", indexed: false },
    ],
  },
] as const;

export const devoxSwapPairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "reserve0", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "reserve1", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint256" },
      { name: "reserve1", type: "uint256" },
    ],
  },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
] as const;

export const devoxSwapRouterAbi = [
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteBuyWithCoti",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "cotiIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteSellForCoti",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "priceInCoti",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pairFor",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "swapExactCotiForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountOutMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "swapExactTokensForCoti",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "addLiquidityCoti",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountToken", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "liquidity", type: "uint256" }],
  },
] as const;

/**
 * DevoxPortal - the crossing between the public and the private side.
 *
 * Wrapping locks a public token and mints its private twin one to one. The twin
 * is a COTI PrivateERC20, so its balances are ciphertext from the moment they
 * exist. `locked` is the public escrow figure, which is deliberately readable:
 * anyone can verify the twin is fully backed.
 */
export const devoxPortalAbi = [
  {
    type: "function",
    name: "wrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publicToken", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "twin", type: "address" }],
  },
  {
    type: "function",
    name: "wrapNative",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "twin", type: "address" }],
  },
  {
    type: "function",
    name: "unwrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publicToken", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unwrapNative",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "twinOf",
    stateMutability: "view",
    inputs: [{ name: "publicToken", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "underlyingOf",
    stateMutability: "view",
    inputs: [{ name: "twin", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "locked",
    stateMutability: "view",
    inputs: [{ name: "publicToken", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "twinCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allTwins", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  {
    type: "event",
    name: "TwinCreated",
    inputs: [
      { name: "underlying", type: "address", indexed: true },
      { name: "twin", type: "address", indexed: true },
      { name: "symbol", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Wrapped",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "underlying", type: "address", indexed: true },
      { name: "twin", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Unwrapped",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "underlying", type: "address", indexed: true },
      { name: "twin", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const devoxPortalTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "portal", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

/**
 * DevoxStaking, and the parts of the treasury a page needs to read.
 *
 * `poolView` exists so one call answers everything a pool card shows; without
 * it the same render would be six round trips per pool. `stakeOf` and
 * `pendingReward` are the per-user half.
 */
export const devoxStakingAbi = [
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "poolView",
    stateMutability: "view",
    inputs: [{ name: "pid", type: "uint256" }],
    outputs: [
      { name: "stakeToken", type: "address" },
      { name: "apyBps", type: "uint32" },
      { name: "active", type: "bool" },
      { name: "totalStaked", type: "uint256" },
      { name: "cap", type: "uint256" },
      { name: "minStake", type: "uint256" },
      { name: "maxPerUser", type: "uint256" },
      { name: "privateToken", type: "bool" },
      { name: "rewardsAvailable", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "stakeOf",
    stateMutability: "view",
    inputs: [
      { name: "pid", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "rewardDebt", type: "uint256" },
          { name: "owed", type: "uint256" },
          { name: "since", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "pendingReward",
    stateMutability: "view",
    inputs: [
      { name: "pid", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "payable",
    inputs: [
      { name: "pid", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unstake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pid", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "pid", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "emergencyUnstake",
    stateMutability: "nonpayable",
    inputs: [{ name: "pid", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "depositsPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export const devoxTreasuryAbi = [
  { type: "function", name: "balance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paidOut", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const devoxpadTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "initialSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "metadataURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
