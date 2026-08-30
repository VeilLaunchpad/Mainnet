import { ImageResponse } from "next/og";

/**
 * The card that appears when a DEVOXPAD link is pasted anywhere.
 *
 * There was none before, so every share rendered as a bare grey rectangle -
 * the one place a brand is guaranteed to be looked at, left blank.
 *
 * Drawn with the same geometry as the token mark rather than by loading the
 * SVG: Satori (what next/og runs) does not resolve external images at render
 * time, so referencing /devox-token.svg would produce an empty box. The shapes
 * below are that mark expressed as divs, which is the price of the format.
 */

export const runtime = "nodejs";
export const alt = "DEVOXPAD — the agentic privacy superapp on COTI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 84px",
          background: "linear-gradient(135deg, #0a1444 0%, #050c22 55%, #04162a 100%)",
          color: "#e9eeff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* the mark: hexagon shell, an X, a sealed centre */}
          <div
            style={{
              display: "flex",
              width: 82,
              height: 82,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              border: "3px solid #00e5ff",
              background: "rgba(30,41,246,0.18)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: 46,
                height: 5,
                borderRadius: 4,
                background: "#8f99ff",
                transform: "rotate(45deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: 46,
                height: 5,
                borderRadius: 4,
                background: "#8f99ff",
                transform: "rotate(-45deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: 15,
                height: 15,
                borderRadius: 15,
                background: "#050c22",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: 8,
                height: 8,
                borderRadius: 8,
                background: "#00e5ff",
              }}
            />
          </div>

          <div style={{ display: "flex", fontSize: 46, fontWeight: 700, letterSpacing: -1 }}>
            <span>DEVOX</span>
            <span style={{ color: "#5a67ff" }}>PAD</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 44,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -2.6,
            maxWidth: 940,
          }}
        >
          The agentic privacy superapp on COTI
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 26,
            fontSize: 29,
            lineHeight: 1.45,
            color: "rgba(233,238,255,0.62)",
            maxWidth: 900,
          }}
        >
          Launch private tokens, trade them, and hold NFTs whose metadata only you can read.
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            paddingTop: 40,
            fontSize: 24,
            color: "rgba(233,238,255,0.45)",
            justifyContent: "space-between",
          }}
        >
          <span>devoxpad-app.vercel.app</span>
          <span>$DEVOX</span>
        </div>
      </div>
    ),
    size,
  );
}
