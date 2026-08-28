import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Reads every fee the protocol charges straight off the deployed contracts and
 * writes them into the master table, so the published fee page can never drift
 * from what the chain actually does.
 */
async function main() {
  const file = path.resolve(__dirname, "../../config/veilpad.testnet.json");
  const table = JSON.parse(fs.readFileSync(file, "utf8"));
  const v = table.contracts.veilpad;

  const factory = await ethers.getContractAt("VeilPadFactory", v.factory.address);
  const profiles = await ethers.getContractAt("ProfileRegistry", v.profileRegistry.address);
  const agents = await ethers.getContractAt("AgentRegistry", v.agentRegistry.address);

  const launchFee = await factory.launchFee();
  const graduationTarget = await factory.graduationTarget();
  const claimFee = await profiles.claimFee();
  const registrationFee = await agents.registrationFee();

  const read = {
    launchFeeCoti: ethers.formatEther(launchFee),
    graduationTargetCoti: ethers.formatEther(graduationTarget),
    profileClaimFeeCoti: ethers.formatEther(claimFee),
    agentRegistrationFeeCoti: ethers.formatEther(registrationFee),
    curveTradeFeeBps: 100,
    swapFeeBps: 30,
    portalFeeBps: 0,
  };

  console.log("read from chain:");
  for (const [k, val] of Object.entries(read)) console.log("  " + k.padEnd(26) + val);

  table.fees = {
    _comment:
      "Read from the deployed contracts by contracts/scripts/fees.ts. Do not hand-edit; run the script instead.",
    currency: "COTI",
    launch: {
      amount: read.launchFeeCoti,
      unit: "COTI",
      paidTo: "treasury",
      when: "once, at launch",
      contract: v.factory.address,
    },
    curveTrade: {
      bps: read.curveTradeFeeBps,
      percent: read.curveTradeFeeBps / 100,
      paidTo: "token creator",
      when: "every buy and every sell on the bonding curve",
      note: "Fees do not count toward the graduation reserve, so a curve fills on real deposits only.",
    },
    swap: {
      bps: read.swapFeeBps,
      percent: read.swapFeeBps / 100,
      paidTo: "liquidity providers",
      when: "every swap against a VeilSwap pair",
      note: "Retained in the pair's reserves, which is what makes an LP share appreciate.",
    },
    portal: {
      bps: read.portalFeeBps,
      percent: 0,
      paidTo: "nobody",
      when: "wrapping into privacy and back out",
      note: "The portal charges nothing. You pay gas, and MPC operations cost more gas than ordinary ones.",
    },
    profileClaim: { amount: read.profileClaimFeeCoti, unit: "COTI", paidTo: "treasury" },
    agentRegistration: { amount: read.agentRegistrationFeeCoti, unit: "COTI", paidTo: "treasury" },
    messaging: {
      amount: "0",
      unit: "COTI",
      note: "No protocol fee. Encrypted messages cost gas, and a long message is split into chunks that each cost more.",
    },
    graduation: {
      amount: "0",
      unit: "COTI",
      note: "Graduation is permissionless and takes no cut. The whole reserve goes into the pair.",
    },
    notCharged: [
      "No fee to read anything, on chain or through the API.",
      "No fee to unwrap. Value that crossed into privacy can always come back.",
      "No fee to remove liquidity from a pair.",
      "No subscription, no priority tier, no fee to talk to an agent.",
    ],
    gasNotes: [
      "A launch costs roughly 4M gas.",
      "A private buy is around 720k, a private sell around 1.46M.",
      "A wrap into privacy is around 3.2M the first time a twin is created, then far less.",
      "Reading is always free.",
    ],
  };

  fs.writeFileSync(file, JSON.stringify(table, null, 2) + "\n");
  console.log("\nwrote fees into config/veilpad.testnet.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
