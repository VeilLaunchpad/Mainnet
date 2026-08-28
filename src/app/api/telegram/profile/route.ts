import { NextRequest } from "next/server";
import {
  BOT_PROFILE,
  applyBotProfile,
  botConfigured,
  checkBotProfile,
  safeEqual,
  webhookSecret,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bot's public identity, deployed rather than typed into BotFather.
 *
 * Keeping the name, bio, about text and command list in the repo means they
 * are reviewed like anything else and cannot drift out of sync with what the
 * bot actually does. Applying them is a full overwrite, so running this twice
 * is harmless.
 */

export async function GET() {
  return Response.json({
    configured: botConfigured(),
    profile: BOT_PROFILE,
    lengths: {
      name: BOT_PROFILE.name.length,
      shortDescription: BOT_PROFILE.shortDescription.length,
      description: BOT_PROFILE.description.length,
    },
    problems: checkBotProfile(),
  });
}

/**
 * Guarded by the same secret Telegram itself presents. This writes to a public
 * profile, so it should not be something any passer-by can trigger.
 */
export async function POST(req: NextRequest) {
  if (!botConfigured()) {
    return Response.json({ ok: false, error: "bot not configured" }, { status: 503 });
  }

  const presented = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(presented, webhookSecret())) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await applyBotProfile();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
