import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16150f",
          color: "#fbfbfa",
          fontSize: 108,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        K
      </div>
    ),
    size,
  );
}
