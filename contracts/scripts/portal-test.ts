import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Proves the portal end to end on a live chain: native COTI into privacy and
 * back out, then a public ERC-20 through the same path.
 */

const GAS = { wrap: 12_000_000n, unwrap: 14_000_000n, approve: 6_000_000n, deposit: 300_000n };

function table() {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../config/veilpad.testnet.json"), "utf8"),
  );
}

const fmt = (v: bigint, d = 18) =>
  Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

async function main() {
  const [signer] = await ethers.getSigners();
  const veilpad = table().contracts.veilpad;
  const portalAddress = veilpad.portal.address;
  const wcotiAddress = veilpad.wcoti.address;

  console.log("signer :", signer.address);
  console.log("portal :", portalAddress);
  console.log("balance:", fmt(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("");

  const portal = await ethers.getContractAt("VeilPortal", portalAddress);

  // ── native COTI into privacy ────────────────────────────────────────────
  console.log("[1] wrapping 0.4 COTI into privacy");
  const wrapAmount = ethers.parseEther("0.4");
  const wrapTx = await portal.wrapNative({ value: wrapAmount, gasLimit: GAS.wrap });
  const wrapReceipt = await wrapTx.wait();
  console.log("    tx  ", wrapTx.hash);
  console.log("    gas ", wrapReceipt!.gasUsed.toString());

  const pCoti = await portal.twinOf(ethers.ZeroAddress);
  const twin = await ethers.getContractAt("VeilPortalToken", pCoti);
  console.log("    twin", pCoti);
  console.log("    name        ", await twin.name());
  console.log("    symbol      ", await twin.symbol());
  console.log("    decimals    ", (await twin.decimals()).toString());
  console.log("    underlying  ", await twin.underlying(), "(zero = native COTI)");
  console.log("    totalSupply ", (await twin.totalSupply()).toString(), " <- 0: the twin is private");
  console.log("    locked      ", fmt(await portal.locked(ethers.ZeroAddress)), "COTI in escrow");

  const ct = await twin["balanceOf(address)"](signer.address);
  console.log("    my balance  ", ct.toString().slice(0, 24) + "... (ciphertext)");
  console.log("");

  // ── and back out ────────────────────────────────────────────────────────
  console.log("[2] portalling 0.15 back to public");
  const backAmount = ethers.parseEther("0.15");

  const reset = await twin["approve(address,uint256)"](portalAddress, 0n, { gasLimit: GAS.approve });
  await reset.wait();
  const approve = await twin["approve(address,uint256)"](portalAddress, backAmount, {
    gasLimit: GAS.approve,
  });
  await approve.wait();

  const before = await ethers.provider.getBalance(signer.address);
  const unwrapTx = await portal.unwrapNative(backAmount, { gasLimit: GAS.unwrap });
  const unwrapReceipt = await unwrapTx.wait();
  const after = await ethers.provider.getBalance(signer.address);

  console.log("    tx  ", unwrapTx.hash);
  console.log("    gas ", unwrapReceipt!.gasUsed.toString());
  console.log("    native delta", fmt(after - before), "COTI (net of gas)");
  console.log("    still locked", fmt(await portal.locked(ethers.ZeroAddress)), "COTI");
  console.log("");

  // ── a public ERC-20 through the same path ──────────────────────────────
  console.log("[3] wrapping a public ERC-20 (WCOTI)");
  const wcoti = await ethers.getContractAt("WCOTI", wcotiAddress);

  const dep = await wcoti.deposit({ value: ethers.parseEther("0.2"), gasLimit: GAS.deposit });
  await dep.wait();
  console.log("    minted 0.2 WCOTI to hold");

  const amount = ethers.parseEther("0.2");
  const wApprove = await wcoti.approve(portalAddress, amount, { gasLimit: GAS.approve });
  await wApprove.wait();

  const wrap2 = await portal.wrap(wcotiAddress, amount, { gasLimit: GAS.wrap });
  await wrap2.wait();

  const pWcoti = await portal.twinOf(wcotiAddress);
  const twin2 = await ethers.getContractAt("VeilPortalToken", pWcoti);
  console.log("    tx  ", wrap2.hash);
  console.log("    twin", pWcoti);
  console.log("    name  ", await twin2.name(), "/", await twin2.symbol());
  console.log("    locked", fmt(await portal.locked(wcotiAddress)), "WCOTI in escrow");
  console.log("");

  console.log("twins created:", (await portal.twinCount()).toString());
  console.log("balance      :", fmt(await ethers.provider.getBalance(signer.address)), "COTI");
  console.log("portal page  : http://localhost:3000/portal");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
