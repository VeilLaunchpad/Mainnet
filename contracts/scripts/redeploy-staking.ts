import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Replaces VeilStaking, keeping the token and the treasury.
 *
 * An audit found two defects after the first deployment: the emergency exit
 * discarded a passive staker's unsettled reward, and `try/catch` around the
 * treasury call did not cover a callee with no code, so pointing the treasury
 * at a bad address would have bricked withdrawals. Both are fixed, and neither
 * touches the token or the reserve, so only staking is replaced.
 *
 * This refuses to run once anything is staked. Migrating live positions is a
 * different and much more delicate job than redeploying an empty contract, and
 * silently doing the first while pretending to do the second is how people lose
 * money. If the old contract holds deposits, this stops and says so.
 */

const GCOTI_MAINNET = "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1";

interface PoolPlan {
  key: string;
  token: string | null;
  apyBps: number;
  cap: bigint;
  minStake: bigint;
  maxPerUser: bigint;
  privateToken: boolean;
}

function plans(veil: string, isMainnet: boolean): PoolPlan[] {
  const gcoti = isMainnet ? GCOTI_MAINNET : process.env.NEXT_PUBLIC_GCOTI_TESTNET || "";
  const list: PoolPlan[] = [
    {
      key: "COTI", token: null, apyBps: 1000,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18),
      privateToken: false,
    },
    {
      key: "VEIL", token: veil, apyBps: 1800,
      cap: ethers.parseUnits("20000000", 18),
      minStake: ethers.parseUnits("1", 18),
      maxPerUser: ethers.parseUnits("2000000", 18),
      privateToken: false,
    },
  ];
  if (isMainnet) {
    // p.COTI, the private twin of COTI from COTI's own privacy bridge. Its
    // balances are ciphertext, which the pool has to be told about: measuring
    // this contract's balance across the transfer would read two encrypted
    // handles and credit the depositor nothing.
    list.splice(1, 0, {
      key: "p.COTI",
      token: "0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91",
      apyBps: 1400,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18),
      privateToken: true,
    });
  }

  if (gcoti && gcoti.startsWith("0x")) {
    list.splice(1, 0, {
      key: "gCOTI", token: gcoti, apyBps: 1200,
      cap: ethers.parseUnits("2000000", 18),
      minStake: ethers.parseUnits("0.1", 18),
      maxPerUser: ethers.parseUnits("200000", 18),
      privateToken: false,
    });
  }
  return list;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isMainnet = network.name === "cotiMainnet";
  const suffix = isMainnet ? "MAINNET" : "TESTNET";
  const netKey = isMainnet ? "mainnet" : "testnet";

  const veilAddress = process.env["NEXT_PUBLIC_VEIL_TOKEN_" + suffix] || "";
  const treasuryAddress = process.env["NEXT_PUBLIC_VEIL_TREASURY_" + suffix] || "";
  const oldStaking = process.env["NEXT_PUBLIC_VEIL_STAKING_" + suffix] || "";
  if (!veilAddress || !treasuryAddress) throw new Error("token or treasury missing for " + netKey);

  console.log("network :", network.name);
  console.log("deployer:", deployer.address);
  console.log("VEILPAD :", veilAddress);
  console.log("treasury:", treasuryAddress);
  console.log("old     :", oldStaking || "(none)", "\n");

  /**
   * Refuse to strand anybody.
   *
   * Deliberately measured by what the old contract actually holds, not by what
   * its `pool()` view reports. The Pool struct changes between versions, so
   * decoding it with the new ABI fails - and a safety check that breaks the
   * moment the contract changes is worse than none, because it fails exactly
   * when it is most needed. Balances are ABI-independent and are the real
   * question anyway: if it holds nothing, nobody is staked.
   */
  if (oldStaking) {
    const native = await ethers.provider.getBalance(oldStaking);
    const erc = ["function balanceOf(address) view returns (uint256)"];

    let held = native;
    const holdings: string[] = [];
    if (native > 0n) holdings.push(ethers.formatEther(native) + " COTI");

    for (const p of plans(veilAddress, isMainnet)) {
      if (!p.token) continue;
      // A private token answers with ciphertext, so its balance cannot be read
      // here at all. Those pools are reported rather than measured.
      if (p.privateToken) {
        holdings.push(p.key + " (private, balance not readable)");
        continue;
      }
      const t = new ethers.Contract(p.token, erc, ethers.provider);
      const b: bigint = await t.balanceOf(oldStaking).catch(() => 0n);
      if (b > 0n) {
        held += b;
        holdings.push(ethers.formatUnits(b, 18) + " " + p.key);
      }
    }

    console.log("old staking holds: " + (holdings.length ? holdings.join(", ") : "nothing"));
    if (held > 0n) {
      throw new Error(
        "The old contract still holds deposits. Migrating live positions is not what this script does.",
      );
    }
  }

  const factory = await ethers.getContractFactory("VeilStaking");
  const args = [veilAddress, treasuryAddress, deployer.address] as const;
  const tx = await factory.getDeployTransaction(...args);
  const estimate: string = await ethers.provider.send("eth_estimateGas", [
    { from: deployer.address, data: tx.data },
    "latest",
  ]);
  const staking = await factory.deploy(...args, {
    gasLimit: (BigInt(estimate) * 125n) / 100n,
  });
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("\n  VeilStaking           " + stakingAddress + "  gas " + BigInt(estimate).toLocaleString("en-US"));

  const treasury = await ethers.getContractAt("VeilTreasury", treasuryAddress);
  const allocation = await treasury.balance();

  if (oldStaking) {
    await (await treasury.setSpender(oldStaking, false, 0, { gasLimit: 200_000 })).wait();
    console.log("  old contract revoked as a spender");
  }
  await (await treasury.setSpender(stakingAddress, true, allocation, { gasLimit: 200_000 })).wait();
  console.log("  new contract approved, budget " + ethers.formatUnits(allocation, 18) + " VEIL");

  console.log("\npools:");
  const created: { pid: number; key: string; token: string; apyBps: number; cap: string }[] = [];
  for (const p of plans(veilAddress, isMainnet)) {
    const token = p.token ?? ethers.ZeroAddress;
    await (
      await staking.addPool(token, p.apyBps, p.cap, p.minStake, p.maxPerUser, p.privateToken, { gasLimit: 500_000 })
    ).wait();
    const pid = Number(await staking.poolCount()) - 1;
    created.push({ pid, key: p.key, token, apyBps: p.apyBps, cap: ethers.formatUnits(p.cap, 18) });
    console.log("  [" + pid + "] " + p.key.padEnd(6) + (p.apyBps / 100).toFixed(1) + "% APY");
  }

  writeEnv({ ["NEXT_PUBLIC_VEIL_STAKING_" + suffix]: stakingAddress });
  patchTable(netKey, stakingAddress, created);

  console.log("\nNEXT_PUBLIC_VEIL_STAKING_" + suffix + "=" + stakingAddress);
  console.log("Updated ../config/veilpad." + netKey + ".json");
}

function patchTable(
  netKey: string,
  stakingAddress: string,
  pools: { pid: number; key: string; token: string; apyBps: number; cap: string }[],
) {
  const file = path.resolve(__dirname, "../../config/veilpad." + netKey + ".json");
  if (!fs.existsSync(file)) return;
  const table = JSON.parse(fs.readFileSync(file, "utf8"));

  if (table?.contracts?.veilpad?.veilStaking) {
    table.contracts.veilpad.veilStaking.address = stakingAddress;
  }
  if (table.staking) {
    table.staking.staking = stakingAddress;
    table.staking.pools = pools.map((p) => ({
      pid: p.pid,
      asset: p.key,
      token: p.token === ethers.ZeroAddress ? null : p.token,
      native: p.token === ethers.ZeroAddress,
      apyPercent: p.apyBps / 100,
      capTokens: p.cap,
    }));
  }
  fs.writeFileSync(file, JSON.stringify(table, null, 2) + "\n");
}

function writeEnv(mapping: Record<string, string>) {
  const envPath = path.resolve(__dirname, "../../.env.local");
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(mapping)) {
    const line = key + "=" + value;
    const re = new RegExp("^" + key + "=.*$", "m");
    text = re.test(text) ? text.replace(re, line) : text.trimEnd() + "\n" + line + "\n";
  }
  fs.writeFileSync(envPath, text);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
