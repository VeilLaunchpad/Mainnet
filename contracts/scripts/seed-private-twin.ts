import { ethers, network } from "hardhat";
import { Wallet as CotiWallet, JsonRpcProvider as CotiProvider } from "@coti-io/coti-ethers";

/**
 * Creates p.DEVOX on the portal the app actually uses, and proves it works.
 *
 * A twin already existed - but it was minted by the previous portal, and the
 * rebrand redeployed that contract. Twins live in the portal that made them, so
 * the new portal's registry was empty: the interface would have offered to wrap
 * DEVOX and the transaction would have reverted. The env variable pointing at
 * the old twin made this worse than a missing feature, because the address
 * resolved and looked fine.
 *
 * `wrap` mints the twin on first use, so the fix is to make the first wrap.
 *
 * The proof at the end is the part worth keeping. p.DEVOX answers balanceOf
 * with a ciphertext, so "it worked" cannot be checked by reading a number the
 * way an ERC-20 lets you - it has to be decrypted with the holder's own key,
 * and a wallet holding a different valid key has to get nothing.
 *
 *   npx hardhat run scripts/seed-private-twin.ts --network cotiMainnet
 */

const WRAP = ethers.parseUnits("250000", 18);

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("mainnet only");
  const [me] = await ethers.getSigners();

  const PORTAL = process.env.NEXT_PUBLIC_PORTAL_MAINNET || "";
  const DEVOX = process.env.NEXT_PUBLIC_DEVOX_TOKEN_MAINNET || "";
  if (!PORTAL || !DEVOX) throw new Error("portal or token address missing");

  const portal = new ethers.Contract(
    PORTAL,
    [
      "function wrap(address publicToken, uint256 amount) returns (address)",
      "function unwrap(address publicToken, uint256 amount)",
      "function twinOf(address) view returns (address)",
    ],
    me,
  );
  const token = new ethers.Contract(
    DEVOX,
    [
      "function approve(address,uint256) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    me,
  );

  console.log("portal :", PORTAL);
  console.log("DEVOX  :", DEVOX);
  console.log("holding:", ethers.formatUnits(await token.balanceOf(me.address), 18), "DEVOX\n");

  let twin = (await portal.twinOf(DEVOX)) as string;

  if (twin === ethers.ZeroAddress) {
    console.log("no twin on this portal yet - the first wrap mints it");
    await (await token.approve(PORTAL, WRAP, { gasLimit: 300_000 })).wait();
    const tx = await portal.wrap(DEVOX, WRAP, { gasLimit: 14_000_000 });
    await tx.wait();
    twin = (await portal.twinOf(DEVOX)) as string;
    console.log("  wrapped " + ethers.formatUnits(WRAP, 18) + " DEVOX   " + tx.hash);
  } else {
    console.log("twin already registered, wrapping a little more");
    await (await token.approve(PORTAL, WRAP, { gasLimit: 300_000 })).wait();
    const tx = await portal.wrap(DEVOX, WRAP, { gasLimit: 14_000_000 });
    await tx.wait();
    console.log("  wrapped " + ethers.formatUnits(WRAP, 18) + " DEVOX   " + tx.hash);
  }

  const meta = new ethers.Contract(
    twin,
    ["function name() view returns (string)", "function symbol() view returns (string)"],
    ethers.provider,
  );
  console.log("\np.DEVOX:", twin);
  console.log("  name  :", await meta.name().catch(() => "?"));
  console.log("  symbol:", await meta.symbol().catch(() => "?"));

  /* ── the balance is a ciphertext, so prove it the only way that counts ── */
  console.log("\nprivacy check:");
  const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
  const rpc = process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc";
  const w = new CotiWallet(pk.startsWith("0x") ? pk : "0x" + pk, new CotiProvider(rpc));
  await w.generateOrRecoverAes();

  /**
   * balanceOf returns a two-word struct, not a number.
   *
   * `ctUint256 { ciphertextHigh, ciphertextLow }` decoded as a single uint256
   * silently yields half a ciphertext, and half a ciphertext decrypts to a
   * plausible-looking 0 - which reads exactly like "the wrap took your tokens
   * and credited nothing". It cost a real investigation to establish that the
   * escrow was correct and the reader was not. Decode the struct, and use
   * decryptValue256, which wants the fields by name rather than as an array.
   */
  const priv = new ethers.Contract(
    twin,
    [
      "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))",
      "function totalSupply() view returns (uint256)",
    ],
    ethers.provider,
  );

  const r = await priv.balanceOf(me.address);
  const ct = { ciphertextHigh: r[0], ciphertextLow: r[1] };
  console.log("  balanceOf returns   : a two-word ciphertext, not a number");

  const clear = await w.decryptValue256(ct as never);
  console.log("  you decrypt         : " + ethers.formatUnits(clear as bigint, 18) + " p.DEVOX");

  const stranger = new CotiWallet(ethers.Wallet.createRandom().privateKey, new CotiProvider(rpc));
  stranger.disableAutoOnboard();
  stranger.setAesKey(ethers.hexlify(ethers.randomBytes(16)).slice(2));
  let saw = "";
  try {
    saw = String(await stranger.decryptValue256(ct as never));
  } catch {
    saw = "<threw>";
  }
  console.log("  a stranger's key    : " + saw.slice(0, 34));
  if (saw === String(clear)) throw new Error("*** a non-holder read the balance ***");
  console.log("  -> the amount is yours alone");

  console.log("\n  totalSupply reads   : " + (await priv.totalSupply()) + "  (0 by design - the sum of ciphertexts is not a number)");
  console.log("\nSet NEXT_PUBLIC_DEVOX_TOKEN_TWIN_MAINNET=" + twin);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
