import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const color = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  border: "#e3e7ed",
  text: "#111827",
  muted: "#6b7280",
  accent: "#1f5fbf",
  accentSoft: "#e6eefb",
  danger: "#c2410c",
  dangerSoft: "#fdf0e9",
  ok: "#15803d",
  eoc: "#6b7280",
  alpha: "#1f5fbf",
  bravo: "#0f8a7e",
  charlie: "#7c3aed",
};

export const font = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// A scene on the plain background that fades in and out at its edges.
export function Scene(props: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, props.duration - 12, props.duration], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: color.bg, fontFamily: font, color: color.text }}>
      <AbsoluteFill style={{ opacity }}>{props.children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

// Fades and lifts its children in, from `at` frames into the scene; `until` fades them out again.
export function Reveal(props: { at: number; until?: number; style?: CSSProperties; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - props.at, fps, config: { damping: 200 } });
  const out = props.until === undefined ? 1 : interpolate(frame, [props.until, props.until + 12], [1, 0], clamp);
  return <div style={{ opacity: p * out, transform: `translateY(${(1 - p) * 28}px)`, ...props.style }}>{props.children}</div>;
}

export function Label(props: { children: ReactNode; tint?: string }) {
  return (
    <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: props.tint ?? color.accent }}>
      {props.children}
    </div>
  );
}

export function Card(props: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: 20,
        boxShadow: "0 8px 30px #1118270d",
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

export function Chip(props: { children: ReactNode; tint?: string; style?: CSSProperties }) {
  const tint = props.tint ?? color.accent;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 16px",
        borderRadius: 999,
        fontSize: 22,
        fontWeight: 600,
        color: tint,
        background: `${tint}14`,
        border: `1.5px solid ${tint}40`,
        ...props.style,
      }}
    >
      {props.children}
    </span>
  );
}

// A caption bar at the bottom of the frame, switching between lines at given frames.
export function Captions(props: { lines: { at: number; text: string }[]; bottom?: number }) {
  const frame = useCurrentFrame();
  const index = props.lines.findLastIndex((l) => l.at <= frame);
  if (index < 0) return null;
  const line = props.lines[index]!;
  const opacity = interpolate(frame - line.at, [0, 10], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: props.bottom ?? 70 }}>
      <div
        style={{
          opacity,
          maxWidth: 1500,
          padding: "20px 36px",
          borderRadius: 16,
          background: "#111827e6",
          color: "#fff",
          fontSize: 36,
          lineHeight: 1.35,
          textAlign: "center",
          fontFamily: font,
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
}

export function Ambulance(props: { size?: number; tint?: string }) {
  const s = props.size ?? 120;
  const tint = props.tint ?? color.accent;
  return (
    <svg width={s} height={s * 0.62} viewBox="0 0 100 62">
      <path d="M4 10h58v38H4z" fill="#fff" stroke={tint} strokeWidth="3" strokeLinejoin="round" />
      <path d="M62 22h18l14 14v12H62z" fill="#fff" stroke={tint} strokeWidth="3" strokeLinejoin="round" />
      <path d="M68 26h11l9 9H68z" fill={`${tint}30`} />
      <path d="M28 19h8v8h8v8h-8v8h-8v-8h-8v-8h8z" fill={color.danger} />
      <rect x="4" y="40" width="90" height="4" fill={tint} />
      <circle cx="22" cy="50" r="8" fill={color.text} />
      <circle cx="76" cy="50" r="8" fill={color.text} />
      <circle cx="22" cy="50" r="3" fill="#fff" />
      <circle cx="76" cy="50" r="3" fill="#fff" />
    </svg>
  );
}

export function TabletIcon(props: { size?: number; tint?: string }) {
  const s = props.size ?? 48;
  const tint = props.tint ?? color.accent;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth="1.8">
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="#fff" />
      <path d="M8 7h8M8 10.5h8M8 14h5" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="0.8" fill={tint} />
    </svg>
  );
}

export function PatientIcon(props: { size?: number }) {
  const s = props.size ?? 56;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill={color.danger} />
      <circle cx="12" cy="9" r="3.4" fill="#fff" />
      <path d="M5.8 18.4c1.2-3 3.5-4.4 6.2-4.4s5 1.4 6.2 4.4" fill="#fff" />
    </svg>
  );
}
