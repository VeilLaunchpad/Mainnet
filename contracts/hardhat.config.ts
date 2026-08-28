import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env.local" });

const PK = process.env.DEPLOYER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Pinned, not inherited. COTI's gcVM is Paris, and a future solc default
      // of Cancun would emit mcopy and transient storage that it cannot execute.
      evmVersion: "paris",
      viaIR: true,
    },
  },
  networks: {
    cotiTestnet: {
      url: process.env.NEXT_PUBLIC_COTI_TESTNET_RPC || "https://testnet.coti.io/rpc",
      chainId: 7082400,
      accounts: PK ? [PK] : [],
    },
    cotiMainnet: {
      url: process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc",
      chainId: 2632500,
      accounts: PK ? [PK] : [],
    },
  },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};

export default config;
