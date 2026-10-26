#!/usr/bin/env node
// External uptime check (run by .github/workflows/uptime.yml every 5 minutes).
// Calls HEALTH_URL (/healthz: server + database). Keeps a tiny state file
// between runs (UPTIME_STATE_FILE): after FAIL_THRESHOLD failures in a row the
// operator gets one "down" mail; the first success after that one "recovered"
// mail. Mail goes through Resend (RESEND_API_KEY, RESEND_FROM_EMAIL) to
// ALERT_EMAIL_TO - the same operator alert the app uses. No dependencies.
import { readFile, writeFile } from "node:fs/promises";

export const FAIL_THRESHOLD = 2;
const TIMEOUT_MS = 10000;

export async function probe(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { "Cache-Control": "no-cache" } });
    let body = "";
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      body = "";
    }
    return { ok: response.status === 200, status: response.status, body, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.name === "AbortError" ? "timeout" : error?.message ?? error), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Pure: next state + which mail to send ("down" | "up" | null).
export function nextState(state, result, now) {
  const prev = { failures: 0, alerted: false, downSince: null, ...(state ?? {}) };
  if (result.ok) {
    const mail = prev.alerted ? "up" : null;
    return { state: { failures: 0, alerted: false, downSince: null, lastOkAt: now }, mail, downSince: prev.downSince };
  }
  const failures = prev.failures + 1;
  const downSince = prev.downSince ?? now;
  if (failures >= FAIL_THRESHOLD && !prev.alerted) {
    return { state: { ...prev, failures, alerted: true, downSince }, mail: "down", downSince };
  }
  return { state: { ...prev, failures, downSince }, mail: null, downSince };
}

async function sendMail({ subject, text }) {
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const to = process.env.ALERT_EMAIL_TO || "lewis.mhstewart@gmail.com";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `[Retracta] ${subject}`, text }),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function main() {
  const url = process.env.HEALTH_URL || "https://app.withdrawbutton.com/healthz";
  const stateFile = process.env.UPTIME_STATE_FILE || "uptime-state.json";
  let state = null;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    state = null;
  }
  const now = new Date().toISOString();
  const result = await probe(url);
  const { state: next, mail, downSince } = nextState(state, result, now);
  console.log(`${now} ${url} -> ${result.status} in ${result.ms} ms (${result.ok ? "ok" : "FAIL"}), failures=${next.failures}, alerted=${next.alerted}`);

  if (mail === "down") {
    await sendMail({
      subject: "App onbereikbaar",
      text: [
        `${url} antwoordt niet goed: ${FAIL_THRESHOLD} controles na elkaar mislukt.`,
        "",
        `Laatste antwoord: status ${result.status || "geen"} (${result.body || "-"})`,
        `Mislukt sinds (UTC): ${downSince}`,
        "",
        "Controleer: fly status -a herroepingsknop-app en fly logs -a herroepingsknop-app (en de database: fly status -a herroepingsknop-app-db).",
        "Bij herstel volgt één herstelmail.",
      ].join("\n"),
    });
    console.log("down mail sent");
  } else if (mail === "up") {
    await sendMail({
      subject: "App weer bereikbaar",
      text: [`${url} antwoordt weer normaal (status ${result.status}, ${result.ms} ms).`, "", `Storing sinds (UTC): ${downSince}`, `Hersteld om (UTC): ${now}`].join("\n"),
    });
    console.log("recovery mail sent");
  }
  await writeFile(stateFile, JSON.stringify(next));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("uptime-check.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
