"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSenseNovaRequest,
  convertMessages,
  listModels,
  normalizeContent,
  toOpenAIResponse,
} = require("../adapters/sensenova-openai-bridge");

test("normalizes text and multimodal content into bridge-safe strings", () => {
  assert.equal(normalizeContent("hello"), "hello");
  assert.equal(
    normalizeContent([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "https://example.test/a.png" } },
    ]),
    "look\n[image:https://example.test/a.png]",
  );
});

test("converts OpenAI-style messages to SenseNova messages", () => {
  assert.deepEqual(
    convertMessages([
      { role: "system", content: "be terse" },
      { role: "user", content: "ping" },
    ]),
    [
      { role: "system", content: "be terse" },
      { role: "user", content: "ping" },
    ],
  );
});

test("builds a SenseNova request without leaking OpenAI-only fields", () => {
  assert.deepEqual(
    buildSenseNovaRequest(
      {
        model: "SenseNova-V6.5-Pro",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 8,
        temperature: 0.2,
        stream: true,
      },
      {},
    ),
    {
      model: "SenseNova-V6.5-Pro",
      messages: [{ role: "user", content: "ping" }],
      max_new_tokens: 8,
      temperature: 0.2,
    },
  );
});

test("maps SenseNova responses to OpenAI chat completion responses", () => {
  const response = toOpenAIResponse(
    {
      data: {
        id: "abc",
        model: "SenseChat",
        choices: [{ message: "OK", finish_reason: "stop" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      },
    },
    "SenseChat",
  );

  assert.equal(response.id, "abc");
  assert.equal(response.object, "chat.completion");
  assert.equal(response.choices[0].message.content, "OK");
  assert.deepEqual(response.usage, {
    prompt_tokens: 3,
    completion_tokens: 1,
    total_tokens: 4,
  });
});

test("lists configured SenseNova models", () => {
  assert.deepEqual(listModels({ OPENCODE_SENSENOVA_MODELS: "a,b" }).data.map((item) => item.id), ["a", "b"]);
});
