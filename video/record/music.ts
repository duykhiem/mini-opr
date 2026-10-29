// Writes public/music.mp3: a calm ambient pad with a soft bell arpeggio, made from sine waves here,
// so the video carries no third-party music licence. Usage: node record/music.ts [seconds]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seconds = Number(process.argv[2] ?? 300);
const rate = 44100;
const n = seconds * rate;
const left = new Float32Array(n);
const right = new Float32Array(n);

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// Cmaj9, Am9, Fmaj9, G6/9, eight seconds each.
const chords = [
  [48, 55, 59, 62, 64],
  [45, 52, 55, 59, 60],
  [41, 48, 52, 55, 57],
  [43, 50, 57, 59, 64],
];
const chordLength = 8;
const fade = 2.5;

for (let c = 0; c * chordLength < seconds; c++) {
  const chord = chords[c % chords.length]!;
  const start = c * chordLength - fade / 2;
  const length = chordLength + fade;
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(n, Math.floor((start + length) * rate));
  chord.forEach((midi, v) => {
    const f = freq(midi);
    const pan = 0.5 + (v - 2) * 0.15;
    for (let i = from; i < to; i++) {
      const t = i / rate;
      const local = t - start;
      const env = Math.min(1, local / fade, (length - local) / fade);
      const s =
        Math.sin(2 * Math.PI * f * 0.999 * t) +
        Math.sin(2 * Math.PI * f * 1.001 * t + v) +
        0.25 * Math.sin(2 * Math.PI * f * 2 * t);
      const wobble = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t + v);
      const a = 0.035 * env * wobble * s;
      left[i]! += a * (1 - pan);
      right[i]! += a * pan;
    }
  });
  // Sub bass on the root.
  const root = freq(chord[0]! - 12);
  for (let i = from; i < to; i++) {
    const t = i / rate;
    const local = t - start;
    const env = Math.min(1, local / fade, (length - local) / fade);
    const a = 0.05 * env * Math.sin(2 * Math.PI * root * t);
    left[i]! += a;
    right[i]! += a;
  }
}

// A quiet bell on every beat at 90 bpm, walking over the chord's upper notes.
const beat = 60 / 90;
const pattern = [4, 2, 3, 1, 4, 3, 2, 0];
for (let b = 0; b * beat < seconds; b++) {
  if (b % 16 === 15) continue;
  const chord = chords[Math.floor((b * beat) / chordLength) % chords.length]!;
  const f = freq(chord[pattern[b % pattern.length]!]! + 12);
  const from = Math.floor(b * beat * rate);
  const to = Math.min(n, from + 3 * rate);
  const pan = 0.3 + 0.4 * ((b * 5) % 7) / 6;
  for (let i = from; i < to; i++) {
    const t = (i - from) / rate;
    const env = Math.exp(-t * 2.2) * Math.min(1, t * 200);
    const s = Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 6);
    const a = 0.03 * env * s;
    left[i]! += a * (1 - pan);
    right[i]! += a * pan;
  }
}

// 16-bit stereo WAV, then reverb, loudness and mp3 in ffmpeg.
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i]!)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i]!)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const outDir = join(videoDir, "out");
mkdirSync(outDir, { recursive: true });
const wav = join(outDir, "music.wav");
writeFileSync(wav, Buffer.concat([header, data]));
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-i", wav,
  "-af", "aecho=0.8:0.6:180|320:0.35|0.25,lowpass=f=6000,loudnorm=I=-20:TP=-2",
  "-ar", "44100", "-b:a", "192k", join(videoDir, "public", "music.mp3"),
]);
console.log(`Wrote public/music.mp3 (${seconds} s)`);
