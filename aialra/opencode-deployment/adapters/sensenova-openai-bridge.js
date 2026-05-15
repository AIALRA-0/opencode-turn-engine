#!/usr/bin/env node
"use strict";

const http = require("node:http");

const DEFAULT_MODELS = [
  "SenseChat",
  "SenseNova-V6.5-Pro",
  "SenseNova-V6.5-Turbo",
];

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error("Invalid JSON body"), { cause: error }));
      }
    });
    req.on("error", reject);
  });
}

function getBearerToken(req, env = process.env) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : env.OPENCODE_SENSETIME_API_KEY;
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return content == null ? "" : String(content);
  }
  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text || "";
      }
      if (part.type === "image_url") {
        const value = part.image_url;
        if (typeof value === "string") {
          return `[image:${value}]`;
        }
        return `[image:${value && value.url ? value.url : "inline"}]`;
      }
      return part.text || "";
    })
    .filter(Boolean)
    .join("\n");
}

function convertMessages(messages) {
  return (messages || []).map((message) => ({
    role: message.role || "user",
    content: normalizeContent(message.content),
  }));
}

function buildSenseNovaRequest(openaiBody, env = process.env) {
  const model = openaiBody.model || env.OPENCODE_SENSENOVA_DEFAULT_MODEL || DEFAULT_MODELS[0];
  const payload = {
    model,
    messages: convertMessages(openaiBody.messages),
  };

  if (openaiBody.temperature != null) {
    payload.temperature = openaiBody.temperature;
  }
  if (openaiBody.top_p != null) {
    payload.top_p = openaiBody.top_p;
  }
  if (openaiBody.max_tokens != null || openaiBody.max_completion_tokens != null) {
    payload.max_new_tokens = openaiBody.max_tokens || openaiBody.max_completion_tokens;
  }
  if (openaiBody.stop != null) {
    payload.stop = openaiBody.stop;
  }

  return payload;
}

function extractAssistantContent(choice) {
  if (!choice) {
    return "";
  }
  if (typeof choice.message === "string") {
    return choice.message;
  }
  if (choice.message && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  if (typeof choice.text === "string") {
    return choice.text;
  }
  if (typeof choice.delta === "string") {
    return choice.delta;
  }
  if (choice.delta && typeof choice.delta.content === "string") {
    return choice.delta.content;
  }
  return "";
}

function normalizeUsage(usage = {}) {
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens,
  };
}

function toOpenAIResponse(senseNovaResponse, requestModel) {
  const payload = senseNovaResponse && senseNovaResponse.data ? senseNovaResponse.data : senseNovaResponse;
  const choice = payload && payload.choices ? payload.choices[0] : null;
  const model = (payload && payload.model) || requestModel;
  const content = extractAssistantContent(choice);

  return {
    id: (payload && payload.id) || `chatcmpl-sensenova-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: (choice && choice.finish_reason) || "stop",
        message: {
          role: "assistant",
          content,
        },
      },
    ],
    usage: normalizeUsage(payload && payload.usage),
  };
}

function streamSingleCompletion(res, completion) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });

  const content = completion.choices[0].message.content || "";
  const chunk = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: null,
      },
    ],
  };
  const done = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: completion.choices[0].finish_reason || "stop",
      },
    ],
  };

  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(`data: ${JSON.stringify(done)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

async function callSenseNova(requestPayload, token, env = process.env) {
  const baseUrl = (env.OPENCODE_SENSENOVA_BASE_URL || "https://api.sensenova.cn").replace(/\/+$/, "");
  const endpoint = env.OPENCODE_SENSENOVA_CHAT_ENDPOINT || "/v1/llm/chat-completions";
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text } };
    }
  }

  if (!response.ok) {
    const message =
      payload && payload.error && payload.error.message
        ? payload.error.message
        : `SenseNova request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function listModels(env = process.env) {
  const configured = env.OPENCODE_SENSENOVA_MODELS;
  const ids = configured ? configured.split(",").map((item) => item.trim()).filter(Boolean) : DEFAULT_MODELS;
  return {
    object: "list",
    data: ids.map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "sensenova",
    })),
  };
}

async function handleChat(req, res, env = process.env) {
  const token = getBearerToken(req, env);
  if (!token) {
    jsonResponse(res, 401, {
      error: {
        message: "Missing SenseNova API key",
        type: "authentication_error",
      },
    });
    return;
  }

  const body = await readBody(req);
  const requestPayload = buildSenseNovaRequest(body, env);
  const response = await callSenseNova(requestPayload, token, env);
  const completion = toOpenAIResponse(response, requestPayload.model);

  if (body.stream) {
    streamSingleCompletion(res, completion);
  } else {
    jsonResponse(res, 200, completion);
  }
}

function createServer(env = process.env) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        jsonResponse(res, 204, {});
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        jsonResponse(res, 200, { ok: true, service: "sensenova-openai-bridge" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        jsonResponse(res, 200, listModels(env));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await handleChat(req, res, env);
        return;
      }

      jsonResponse(res, 404, {
        error: {
          message: `Unknown route: ${req.method} ${url.pathname}`,
          type: "not_found",
        },
      });
    } catch (error) {
      jsonResponse(res, error.status || 500, {
        error: {
          message: error.message || "Internal bridge error",
          type: "bridge_error",
          upstream: error.payload,
        },
      });
    }
  });
}

if (require.main === module) {
  const host = process.env.OPENCODE_SENSENOVA_BRIDGE_HOST || "127.0.0.1";
  const port = Number(process.env.OPENCODE_SENSENOVA_BRIDGE_PORT || "12602");
  createServer().listen(port, host, () => {
    console.log(`SenseNova OpenAI-compatible bridge listening on http://${host}:${port}`);
  });
}

module.exports = {
  DEFAULT_MODELS,
  buildSenseNovaRequest,
  convertMessages,
  createServer,
  listModels,
  normalizeContent,
  toOpenAIResponse,
};
