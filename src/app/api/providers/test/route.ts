import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSettings } from "@/lib/settings";
import { PROVIDER_IDS, isProviderId, type ProviderId } from "@/lib/api";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

function isProvider(value: unknown): value is ProviderId {
  return isProviderId(value);
}

async function testOllama(baseUrl: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`);
  } catch {
    return { ok: false, error: `Can't reach Ollama at ${baseUrl} — is it running? (start it with \`ollama serve\`)` };
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Ollama error (${res.status}): ${body.slice(0, 200)}` };
  }
  const data = await res.json();
  const models: string[] = Array.isArray(data?.models) ? data.models.map((m: { name: string }) => m.name) : [];
  return { ok: true, models };
}

async function testAnthropic(apiKey: string, model: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new Anthropic({ apiKey });
  try {
    await client.models.retrieve(model);
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, error: "Invalid Anthropic API key." };
      }
      if (err.status === 404) {
        return { ok: false, error: `Model "${model}" isn't available for this Anthropic API key.` };
      }
      return { ok: false, error: `Anthropic API error: ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Anthropic test failed" };
  }
}

async function testOpenAI(apiKey: string, model: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new OpenAI({ apiKey });
  try {
    await client.models.retrieve(model);
    return { ok: true };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, error: "Invalid OpenAI API key." };
      }
      if (err.status === 404) {
        return { ok: false, error: `Model "${model}" isn't available for this OpenAI API key.` };
      }
      return { ok: false, error: `OpenAI API error: ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "OpenAI test failed" };
  }
}

// Shared by gemini (pinned to Google's OpenAI-compatible base URL) and the
// user-configured openai-compatible endpoint: GET {base}/models, bearer auth
// only when a key is present.
async function testCompatModels(baseUrl: string, apiKey: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
  } catch {
    return { ok: false, error: `Can't reach ${baseUrl} — check the base URL` };
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "API key rejected" };
    }
    const body = await res.text();
    return { ok: false, error: `Endpoint error (${res.status}): ${body.slice(0, 200)}` };
  }
  const data = await res.json();
  const models: string[] = Array.isArray(data?.data)
    ? data.data.map((m: { id?: string }) => m.id).filter((id: unknown): id is string => Boolean(id))
    : [];
  return { ok: true, models };
}

export async function POST(req: NextRequest) {
  let body: { provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isProvider(body.provider)) {
    return NextResponse.json({ error: `Unknown provider: "${body.provider}". Must be one of ${PROVIDER_IDS.join(", ")}.` }, { status: 400 });
  }

  const settings = getSettings();

  if (body.provider === "ollama") {
    const result = await testOllama(settings.ollamaBaseUrl);
    return NextResponse.json(result);
  }

  if (body.provider === "anthropic") {
    if (!settings.anthropicApiKey) {
      return NextResponse.json({ error: "Anthropic API key not set — add it in Settings" }, { status: 400 });
    }
    const result = await testAnthropic(settings.anthropicApiKey, settings.anthropicModel);
    return NextResponse.json(result);
  }

  if (body.provider === "openai") {
    if (!settings.openaiApiKey) {
      return NextResponse.json({ error: "OpenAI API key not set — add it in Settings" }, { status: 400 });
    }
    const result = await testOpenAI(settings.openaiApiKey, settings.openaiModel);
    return NextResponse.json(result);
  }

  if (body.provider === "gemini") {
    if (!settings.geminiApiKey) {
      return NextResponse.json({ error: "Gemini API key not set — add it in Settings" }, { status: 400 });
    }
    const result = await testCompatModels(GEMINI_BASE_URL, settings.geminiApiKey);
    return NextResponse.json(result);
  }

  if (!settings.compatBaseUrl) {
    return NextResponse.json({ error: "Base URL not set — add it in Settings" }, { status: 400 });
  }
  const result = await testCompatModels(settings.compatBaseUrl, settings.compatApiKey);
  return NextResponse.json(result);
}
