import type { DocPage } from "./docs-types";

/**
 * The NFT documentation.
 *
 * Kept in its own module because it is long, and because the privacy model it
 * describes is the one thing here a reader genuinely cannot guess from
 * experience with other chains. Most of this page is spent on that.
 */

export const nftPage: DocPage = {
  slug: "nft",
  title: "NFTs",
  description:
    "A marketplace and a candy machine on COTI, where the metadata is sealed to whoever holds the token.",
  sections: [
    {
      id: "what",
      title: "What is different here",
      blocks: [
        {
          type: "p",
          text: "An NFT on any other chain is public. The image, the traits, the unlockable content behind it - all of it sits on a server or on IPFS, and 'reveal after mint' means somebody has agreed not to flip a flag early. It is a promise, and promises are broken by accident as often as on purpose.",
        },
        {
          type: "p",
          text: "On COTI it is arithmetic. Every DEVOXPAD collection carries two halves: a public preview that any marketplace can render, and private metadata held on-chain as a ciphertext. The private half is sealed to the current owner's key, and re-sealed to the new owner every time the token moves. Nobody who does not hold it can read it - not the creator, not the marketplace, not an indexer, not us.",
        },
        {
          type: "note",
          tone: "good",
          title: "Why two halves and not one",
          text: "A card with nothing on it is not a listing. If everything were encrypted, no marketplace could show the collection at all and nobody could decide whether to buy. So the preview stays public on purpose, and the part worth protecting is the part that gets sealed.",
        },
        {
          type: "h3",
          text: "What the chain actually stores",
          id: "storage",
        },
        {
          type: "table",
          head: ["Value", "Visibility", "Who can read it"],
          rows: [
            ["previewURI", "Public", "Anyone. It is meant to be rendered."],
            ["Traits, name, description", "Public", "Pinned to IPFS alongside the preview."],
            ["The sealed metadata", "Ciphertext", "The current holder, and only them."],
            ["Owner, supply, price", "Public", "Ordinary ERC-721 state."],
          ],
        },
      ],
    },
    {
      id: "formats",
      title: "Two formats",
      blocks: [
        {
          type: "p",
          text: "The Studio launches one of two contracts, and the choice is not cosmetic - they behave differently because they are for different things.",
        },
        {
          type: "steps",
          items: [
            {
              title: "Scheduled drop (ERC-721)",
              text: "A fixed run of unique tokens with a supply that cannot grow, an optional start time, an optional allowlist presale, and a per-wallet cap. This is the candy machine. Each token is unique, has one owner, and its private metadata is sealed to that owner.",
            },
            {
              title: "Open collection (ERC-1155)",
              text: "Editions the creator keeps adding to, each mintable by many people at once, with a supply that can be left open-ended. A print shop rather than a gallery opening.",
            },
          ],
        },
        {
          type: "h3",
          text: "How privacy works when an edition has many holders",
          id: "editions-privacy",
        },
        {
          type: "p",
          text: "A unique token has exactly one owner, so COTI seals its metadata to that one address. An edition has hundreds of holders at once, so there is no single address to seal to. Instead each edition keeps one network ciphertext - readable by nobody, including the contract - and every holder gets their own copy of it sealed to their own key the first time a copy reaches them.",
        },
        {
          type: "note",
          tone: "info",
          title: "Two hundred holders, two hundred ciphertexts",
          text: "The same secret, encrypted two hundred separate ways. Each one is useless to the other hundred and ninety-nine. This is verified on a live network rather than asserted: the test mints an edition, sends one copy to a second wallet with its own onboarded key, and checks that both read the same plaintext from different ciphertext, while a third wallet holding a valid COTI key reads only noise.",
        },
        {
          type: "p",
          text: "Access is granted on receipt and deliberately never revoked when a holder's balance falls to zero. Revoking would be theatre - they have already read it, and a chain cannot un-tell somebody something - and it would punish the honest case where somebody sells one of three copies.",
        },
      ],
    },
    {
      id: "launch-methods",
      title: "Solo, or paired with a token",
      blocks: [
        {
          type: "p",
          text: "The second choice in the Studio is what the collection is worth holding for.",
        },
        {
          type: "steps",
          items: [
            {
              title: "Solo",
              text: "The collection stands alone. Holders own the art and its sealed metadata, and nothing else. No rewards, no pool, no promises.",
            },
            {
              title: "Paired with $token",
              text: "The launcher deposits a reward budget in the same flow, and a staking pool opens against it. Holders stake their NFTs and earn a fixed rate per NFT per year, paid from tokens the staking contract already holds.",
            },
          ],
        },
        {
          type: "note",
          tone: "good",
          title: "The budget moves first",
          text: "The escrow is transferred before the pool opens. That ordering is the whole guarantee: the yield is paid from tokens that already exist in the contract, not from an intention to fund it later. When the budget runs out, rewards stop - and every pool publishes its runway so you can see how long it has.",
        },
        {
          type: "h3",
          text: "How the APY is worked out",
          id: "apy",
        },
        {
          type: "p",
          text: "A launcher sets two numbers: how much one staked NFT earns per year, and a notional value per NFT to measure that against. The percentage is simply the first divided by the second.",
        },
        {
          type: "code",
          lang: "text",
          code: `apyBps = rewardPerNftPerYear * 10000 / notionalPerNft`,
        },
        {
          type: "note",
          tone: "warn",
          title: "A free mint has no percentage",
          text: "If the notional is zero - which is the honest setting for a free mint, because there is no cost basis to be a percentage of - apyBps returns 0 and the interface shows the absolute rate instead, e.g. '500 DEVOX per NFT per year'. Inventing a notional so a percentage could be displayed would be inventing the percentage.",
        },
      ],
    },
    {
      id: "genesis",
      title: "DEVOXPAD Genesis",
      blocks: [
        {
          type: "p",
          text: "The official collection, and the reference implementation of everything above.",
        },
        {
          type: "kv",
          rows: [
            { k: "Supply", v: "10,000" },
            { k: "Price", v: "Free mint" },
            { k: "Per wallet", v: "10" },
            { k: "Launch method", v: "Paired with $DEVOX" },
            { k: "Reward", v: "500 DEVOX per NFT per year" },
            { k: "Escrowed up front", v: "5,000,000 DEVOX" },
            { k: "Royalty", v: "5% to the creator" },
          ],
        },
        {
          type: "p",
          text: "Its address was mined with CREATE2 to end in 8888, like every DEVOXPAD launch, and it carries the official badge on the marketplace. The badge is set by the marketplace owner and cannot be set by a collection about itself, which is what makes it worth anything.",
        },
      ],
    },
    {
      id: "marketplace",
      title: "The marketplace",
      blocks: [
        {
          type: "p",
          text: "Listings are approval-based. Your token stays in your wallet from the moment you list until the moment somebody buys it, and the marketplace only ever moves it as part of a sale that pays you in the same transaction.",
        },
        {
          type: "note",
          tone: "info",
          title: "Why the marketplace never takes custody",
          text: "It could not, without breaking the privacy. Transferring a token to an escrow contract would re-seal its private metadata to the escrow contract - which can hold a ciphertext but has no key to read it, and would then have to re-seal again to the buyer. Leaving the token with its owner avoids two pointless MPC round trips and one very confusing intermediate state.",
        },
        {
          type: "p",
          text: "Because a listing does not take custody, it can go stale: the seller may transfer or sell the token elsewhere. Rather than hiding those, every listing is checked against the chain and a dead one is shown with the reason it cannot be filled.",
        },
        {
          type: "h3",
          text: "Offers",
          id: "offers",
        },
        {
          type: "p",
          text: "Offers work the other way round. An offer escrows the bidder's ERC-20 up front, because an offer that cannot be paid is not an offer. Cancelling returns it, and accepting settles both sides at once.",
        },
      ],
    },
    {
      id: "unlocking",
      title: "Unlocking what you own",
      blocks: [
        {
          type: "p",
          text: "Press Unlock on a token you hold. The first time, your wallet signs once to derive your COTI AES key; after that it is cached in your browser and every unlock is instant.",
        },
        {
          type: "steps",
          items: [
            {
              title: "Read the ciphertext",
              text: "tokenURI on a drop, or secretOf(editionId, you) on an open collection. Both return a ctString - an array of numbers, not a URL.",
            },
            {
              title: "Decrypt locally",
              text: "The SDK decrypts it in the page with your key. Nothing is sent anywhere; the plaintext exists only in that tab.",
            },
            {
              title: "It follows the token",
              text: "Sell it and the contract re-seals the metadata to the buyer on transfer. Your cached key stops opening it, because it is no longer yours.",
            },
          ],
        },
        {
          type: "note",
          tone: "warn",
          title: "One key, one network",
          text: "The AES key is per account and per network. COTI mainnet and testnet run separate MPC networks, so a key derived on one does not decrypt the other's ciphertext. The app keys its cache by both, which is why switching networks does not silently show you the wrong thing.",
        },
      ],
    },
    {
      id: "addresses",
      title: "Contracts",
      blocks: [
        {
          type: "p",
          text: "The NFT stack on COTI mainnet, chain 2632500.",
        },
        {
          type: "kv",
          rows: [
            { k: "DevoxNFTFactory", v: "0xca4E24923724C09F905593988487338780e3424a" },
            { k: "DevoxNFTEditionsFactory", v: "0x47506dFEA23658333178eb52997e549Bf197E079" },
            { k: "DevoxNFTMarket", v: "0x83dAA54A3d5D96434458a294Af60a39A6EF04791" },
            { k: "DevoxNFTStaking", v: "0x2438202dd999022da10c6E6ac914cBC6a72E0cd2" },
            { k: "DEVOXPAD Genesis", v: "0x262ee68C9a01fC3f362e06c857CF0D6384898888" },
          ],
        },
        {
          type: "h3",
          text: "Reading a sealed value yourself",
          id: "sdk",
        },
        {
          type: "code",
          lang: "ts",
          code: `import { Wallet, JsonRpcProvider } from "@coti-io/coti-ethers";

const wallet = new Wallet(PRIVATE_KEY, new JsonRpcProvider("https://mainnet.coti.io/rpc"));
await wallet.generateOrRecoverAes();

const drop = new Contract(GENESIS, dropAbi, wallet);

// Not a URL - a ciphertext sealed to whoever owns this token.
const sealed = await drop.tokenURI(1n);

// decryptValue is async. Forgetting to await it returns "[object Promise]",
// which is a string, and will pass a naive "did I get something back" check.
const plaintext = await wallet.decryptValue(sealed);`,
          caption: "Only the holder's key produces the plaintext. Any other valid key returns noise.",
        },
      ],
    },
    {
      id: "telegram",
      title: "In Telegram",
      blocks: [
        {
          type: "p",
          text: "The bot shares one wallet link with the website: connect once, and both sides know who you are. It can browse collections, show a collection's stats, and report what you hold and what you are earning.",
        },
        {
          type: "code",
          lang: "text",
          code: `/nft                the marketplace: official and newest collections
/nft <address>      one collection - supply, price, staking, whether it is official
/mynft              what you hold, and what it is earning
/nftstake           every pool, its rate and its runway`,
        },
        {
          type: "note",
          tone: "warn",
          title: "Unlocking is not a bot feature, on purpose",
          text: "Decrypting needs your COTI AES key. Putting that key anywhere near a server - even briefly, even ours - would undo the entire point of sealing the metadata in the first place. So the bot shows you what you own and links you to the browser, where the key stays.",
        },
      ],
    },
  ],
};
