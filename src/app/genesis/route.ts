import { addressesFor } from "@/lib/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The public half of DEVOXPAD Genesis.
 *
 * The collection's previewURI points here, so this has to be real metadata
 * rather than a placeholder - a marketplace that cannot resolve it shows an
 * empty card. Everything below is deliberately public.
 *
 * The private half is not here and cannot be: it lives on-chain as a
 * ciphertext sealed to whoever holds each token, and this server has no key
 * that would open it.
 */
export function GET() {
  const genesis = addressesFor("mainnet").nftGenesis;

  return Response.json(
    {
      name: "DEVOXPAD Genesis",
      description:
        "The official DEVOXPAD collection on COTI. 10,000 free to mint, ten per wallet, paired with $DEVOX so a staked Genesis earns yield. Each token carries private metadata sealed to its holder's key and re-sealed on every transfer — the preview you are reading is public, and the rest is not readable by anyone but the owner.",
      image: "https://devoxpad-nft.vercel.app/genesis.svg",
      external_url: "https://devoxpad-nft.vercel.app/nft/collection/" + genesis,
      attributes: [
        { trait_type: "Collection", value: "Official" },
        { trait_type: "Chain", value: "COTI" },
        { trait_type: "Standard", value: "PrivateERC721" },
        { trait_type: "Metadata", value: "Sealed to holder" },
        { trait_type: "Supply", value: "10000" },
        { trait_type: "Mint", value: "Free" },
        { trait_type: "Paired with", value: "$DEVOX" },
        { trait_type: "Reward", value: "500 DEVOX per NFT per year" },
      ],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
