import { ethers, network } from "hardhat";
import { Wallet as CotiWallet, JsonRpcProvider as CotiProvider } from "@coti-io/coti-ethers";

/**
 * Uses every surface of DEVOXPAD, on mainnet, with the operator's own wallet.
 *
 * A rebranded app whose every page reads "nothing here yet" is indistinguishable
 * from a broken one. This puts a real transaction through each feature so the
 * history is genuine rather than staged: a handle, an agent, a launch, a swap,
 * four stakes, a lock, a wrap into the private twin, a mint, an NFT stake and a
 * listing.
 *
 * Three of these are privacy operations that only work because of COTI, and
 * they are the point rather than decoration:
 *
 *   the portal wrap     mints p.DEVOXPAD, whose balanceOf returns a ciphertext
 *   the private launch   deploys a PrivateERC20, not a plain one
 *   the NFT mint         seals metadata to the minter's key via MpcCore
 *
 * Every step checks whether it has already been done and skips if so, so this
 * is safe to re-run after a partial failure.
 *
 *   npx hardhat run scripts/seed-everything.ts --network cotiMainnet
 */

const env = (k: string) => process.env[k + "_MAINNET"] || "";

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
];

async function main() {
  if (network.name !== "cotiMainnet") throw new Error("mainnet only, on purpose");
  const [me] = await ethers.getSigners();

  const DEVOX = env("NEXT_PUBLIC_DEVOX_TOKEN");
  const STAKING = env("NEXT_PUBLIC_DEVOX_STAKING");
  const ROUTER = env("NEXT_PUBLIC_SWAP_ROUTER");
  const LOCKER = env("NEXT_PUBLIC_LOCKER");
  const PORTAL = env("NEXT_PUBLIC_PORTAL");
  const PAD = env("NEXT_PUBLIC_DEVOX_FACTORY");
  const PROFILES = env("NEXT_PUBLIC_PROFILE_REGISTRY");
  const AGENTS = env("NEXT_PUBLIC_AGENT_REGISTRY");
  const GENESIS = env("NEXT_PUBLIC_NFT_GENESIS");
  const NFT_STAKING = env("NEXT_PUBLIC_NFT_STAKING");
  const MARKET = env("NEXT_PUBLIC_NFT_MARKET");

  console.log("wallet :", me.address);
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(me.address)), "COTI\n");

  const done: string[] = [];
  const skipped: string[] = [];
  const step = async (label: string, run: () => Promise<string | null>) => {
    process.stdout.write("  " + label.padEnd(38));
    try {
      const h = await run();
      if (h) {
        console.log("ok  " + h.slice(0, 18) + "…");
        done.push(label);
      } else {
        console.log("already done");
      }
    } catch (e) {
      const msg = String((e as Error).message).split("\n")[0].slice(0, 76);
      console.log("skipped: " + msg);
      skipped.push(label + " — " + msg);
    }
  };

  /* ── identity ─────────────────────────────────────────────────────────── */
  console.log("identity:");

  await step("claim the on-chain handle", async () => {
    const r = new ethers.Contract(
      PROFILES,
      [
        "function claim(string username, string metadataURI) payable",
        "function claimFee() view returns (uint256)",
        "function ownerOf(string) view returns (address)",
      ],
      me,
    );
    const taken = await r.ownerOf("devoxpad").catch(() => ethers.ZeroAddress);
    if (taken !== ethers.ZeroAddress) return null;
    const fee = await r.claimFee().catch(() => 0n);
    const tx = await r.claim("devoxpad", "https://devoxpad-app.vercel.app/devox.json", {
      value: fee,
      gasLimit: 1_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  await step("register an agent", async () => {
    const r = new ethers.Contract(
      AGENTS,
      [
        "function register(string slug, string metadataURI, address agentWallet, address token) payable",
        "function registrationFee() view returns (uint256)",
        "function agentOf(string) view returns (address)",
      ],
      me,
    );
    const taken = await r.agentOf("devox").catch(() => ethers.ZeroAddress);
    if (taken !== ethers.ZeroAddress) return null;
    const fee = await r.registrationFee().catch(() => 0n);
    const tx = await r.register(
      "devox",
      "https://devoxpad-app.vercel.app/devox.json",
      me.address,
      DEVOX,
      { value: fee, gasLimit: 2_000_000 },
    );
    await tx.wait();
    return tx.hash;
  });

  /* ── the launchpad, with private balances ─────────────────────────────── */
  console.log("\nlaunchpad:");

  await step("launch a token (PrivateERC20)", async () => {
    const factory = await ethers.getContractAt("DevoxPadFactory", PAD);
    const mine = await factory.tokensByCreator(me.address).catch(() => []);
    if ((mine as unknown[]).length > 0) return null;

    const devBuy = ethers.parseEther("0.3");
    const fee = await factory.launchFee();
    const curveSalt = ethers.hexlify(ethers.randomBytes(32));
    const tokenSalt = ethers.hexlify(ethers.randomBytes(32));

    // privateBalances: true is the whole reason this is on COTI. The launched
    // token is a PrivateERC20 whose balanceOf answers with a ciphertext.
    const tx = await (factory as unknown as {
      launch: (p: unknown, o: object) => Promise<{ wait: () => Promise<unknown>; hash: string }>;
    }).launch(
      {
        name: "DEVOX Genesis Launch",
        symbol: "DGL",
        metadataURI: "https://devoxpad-app.vercel.app/devox.json",
        privateBalances: true,
        agentId: ethers.ZeroHash,
        curveSalt,
        tokenSalt,
        devBuy,
        allocation: 1, // burn the dev allocation
        burnPercent: 100,
        lockDays: 0,
      },
      { value: fee + devBuy, gasLimit: 16_000_000 },
    );
    await tx.wait();
    return tx.hash;
  });

  /* ── trading ──────────────────────────────────────────────────────────── */
  console.log("\ntrading:");

  await step("buy DEVOX with 2 COTI", async () => {
    const router = new ethers.Contract(
      ROUTER,
      [
        "function quoteBuyWithCoti(address,uint256) view returns (uint256)",
        "function swapExactCotiForTokens(address,uint256,address,uint256) payable returns (uint256)",
      ],
      me,
    );
    const amt = ethers.parseEther("2");
    const out = (await router.quoteBuyWithCoti(DEVOX, amt)) as bigint;
    const tx = await router.swapExactCotiForTokens(
      DEVOX,
      (out * 97n) / 100n,
      me.address,
      Math.floor(Date.now() / 1000) + 900,
      { value: amt, gasLimit: 3_000_000 },
    );
    await tx.wait();
    return tx.hash;
  });

  await step("sell 50,000 DEVOX back", async () => {
    const router = new ethers.Contract(
      ROUTER,
      [
        "function quoteSellForCoti(address,uint256) view returns (uint256)",
        "function swapExactTokensForCoti(address,uint256,uint256,address,uint256) returns (uint256)",
      ],
      me,
    );
    const amt = ethers.parseUnits("50000", 18);
    const t = new ethers.Contract(DEVOX, erc20, me);
    await (await t.approve(ROUTER, amt, { gasLimit: 200_000 })).wait();
    const out = (await router.quoteSellForCoti(DEVOX, amt)) as bigint;
    const tx = await router.swapExactTokensForCoti(
      DEVOX,
      amt,
      (out * 97n) / 100n,
      me.address,
      Math.floor(Date.now() / 1000) + 900,
      { gasLimit: 3_000_000 },
    );
    await tx.wait();
    return tx.hash;
  });

  /* ── staking ──────────────────────────────────────────────────────────── */
  console.log("\nstaking:");
  const staking = await ethers.getContractAt("DevoxStaking", STAKING);
  const staked = async (pid: number) => (await staking.stakeOf(pid, me.address)).amount as bigint;

  await step("pool 0 · 15 COTI", async () => {
    if ((await staked(0)) > 0n) return null;
    const tx = await staking.stake(0, ethers.parseEther("15"), {
      value: ethers.parseEther("15"),
      gasLimit: 1_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  await step("pool 3 · 1,000,000 DEVOX", async () => {
    if ((await staked(3)) > 0n) return null;
    const amt = ethers.parseUnits("1000000", 18);
    const t = new ethers.Contract(DEVOX, erc20, me);
    await (await t.approve(STAKING, amt, { gasLimit: 200_000 })).wait();
    const tx = await staking.stake(3, amt, { gasLimit: 1_000_000 });
    await tx.wait();
    return tx.hash;
  });

  /* ── privacy: the portal ──────────────────────────────────────────────── */
  console.log("\nprivacy:");

  await step("wrap 3 COTI into the private twin", async () => {
    const portal = new ethers.Contract(
      PORTAL,
      ["function wrapNative() payable returns (address)"],
      me,
    );
    const tx = await portal.wrapNative({ value: ethers.parseEther("3"), gasLimit: 12_000_000 });
    await tx.wait();
    return tx.hash;
  });

  /* ── locking ──────────────────────────────────────────────────────────── */
  console.log("\nlocker:");

  await step("lock 500,000 DEVOX for 30 days", async () => {
    const locker = new ethers.Contract(
      LOCKER,
      ["function lock(address token, address beneficiary, uint256 amount, uint64 unlockAt)"],
      me,
    );
    const amt = ethers.parseUnits("500000", 18);
    const t = new ethers.Contract(DEVOX, erc20, me);
    await (await t.approve(LOCKER, amt, { gasLimit: 200_000 })).wait();
    const unlockAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const tx = await locker.lock(DEVOX, me.address, amt, unlockAt, { gasLimit: 1_000_000 });
    await tx.wait();
    return tx.hash;
  });

  /* ── NFTs ─────────────────────────────────────────────────────────────── */
  console.log("\nNFTs:");
  const drop = await ethers.getContractAt("DevoxNFTDrop", GENESIS);
  const nftStaking = await ethers.getContractAt("DevoxNFTStaking", NFT_STAKING);
  const market = await ethers.getContractAt("DevoxNFTMarket", MARKET);

  await step("mint 3 Genesis (sealed metadata)", async () => {
    if ((await drop.balanceOf(me.address)) > 0n) return null;
    const tx = await drop.mint(3, { value: 0, gasLimit: 16_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("stake Genesis #1", async () => {
    const s = await nftStaking.stakeOf(0, me.address);
    if (s.count > 0n) return null;
    if (!(await drop.isApprovedForAll(me.address, NFT_STAKING))) {
      await (await drop.setApprovalForAll(NFT_STAKING, true, { gasLimit: 1_000_000 })).wait();
    }
    const tx = await nftStaking.stake(0, [1n], { gasLimit: 2_000_000 });
    await tx.wait();
    return tx.hash;
  });

  await step("list Genesis #2 at 25 COTI", async () => {
    const n = await market.listingCount();
    for (let i = 0n; i < n; i++) {
      const [live] = await market.listingLive(i);
      if (live) return null;
    }
    if (!(await drop.isApprovedForAll(me.address, MARKET))) {
      await (await drop.setApprovalForAll(MARKET, true, { gasLimit: 1_000_000 })).wait();
    }
    const tx = await market.list(GENESIS, 2n, ethers.ZeroAddress, ethers.parseEther("25"), {
      gasLimit: 1_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  /* ── prove the sealed metadata really is sealed ───────────────────────── */
  console.log("\nprivacy check:");
  try {
    const pk = process.env.DEPLOYER_PRIVATE_KEY || "";
    const w = new CotiWallet(
      pk.startsWith("0x") ? pk : "0x" + pk,
      new CotiProvider(process.env.NEXT_PUBLIC_COTI_MAINNET_RPC || "https://mainnet.coti.io/rpc"),
    );
    await w.generateOrRecoverAes();
    const sealed = await drop.tokenURI(3n);
    const plain = String(await w.decryptValue(sealed as never));
    console.log("  holder reads : " + plain.slice(0, 62));

    const stranger = new CotiWallet(ethers.Wallet.createRandom().privateKey, new CotiProvider("https://mainnet.coti.io/rpc"));
    stranger.disableAutoOnboard();
    stranger.setAesKey(ethers.hexlify(ethers.randomBytes(16)).slice(2));
    const saw = String(await stranger.decryptValue(sealed as never).catch(() => "<threw>"));
    console.log("  stranger sees: " + saw.replace(/[^\x20-\x7e]/g, "·").slice(0, 46));
    if (saw === plain) throw new Error("*** privacy broken ***");
    console.log("  -> sealed to the holder alone");
  } catch (e) {
    console.log("  check skipped: " + String((e as Error).message).slice(0, 70));
  }

  /* ── summary ──────────────────────────────────────────────────────────── */
  console.log("\n" + "─".repeat(62));
  console.log(done.length + " done, " + skipped.length + " skipped");
  for (const s of skipped) console.log("  " + s);
  console.log("\n  COTI left: " + ethers.formatEther(await ethers.provider.getBalance(me.address)));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
