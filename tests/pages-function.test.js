import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/submit.js";

const endpoint = "https://ads-planner.teckhub.net/api/submit";

function makeRequest(headers = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({ test: true })
  });
}

test("rejects missing Access authentication", async () => {
  const response = await onRequestPost({
    request: makeRequest(),
    env: {}
  });

  assert.equal(response.status, 401);
});

test("rejects missing API service binding", async () => {
  const response = await onRequestPost({
    request: makeRequest({
      Cookie: "CF_Authorization=test-token"
    }),
    env: {}
  });

  assert.equal(response.status, 503);
});

test("forwards Access cookie JWT through service binding", async () => {
  let forwardedRequest;

  const response = await onRequestPost({
    request: makeRequest({
      Cookie: "CF_Authorization=test-token"
    }),
    env: {
      PLANNER_API: {
        fetch: async request => {
          forwardedRequest = request;
          return Response.json({ received: true });
        }
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(
    forwardedRequest.headers.get("Cf-Access-Jwt-Assertion"),
    "test-token"
  );
  assert.equal(
    forwardedRequest.headers.get("Origin"),
    "https://ads-planner.teckhub.net"
  );
  assert.equal(
    new URL(forwardedRequest.url).pathname,
    "/submit"
  );
});

test("prefers Access JWT header over cookie", async () => {
  let forwardedRequest;

  await onRequestPost({
    request: makeRequest({
      "Cf-Access-Jwt-Assertion": "header-token",
      Cookie: "CF_Authorization=cookie-token"
    }),
    env: {
      PLANNER_API: {
        fetch: async request => {
          forwardedRequest = request;
          return Response.json({ received: true });
        }
      }
    }
  });

  assert.equal(
    forwardedRequest.headers.get("Cf-Access-Jwt-Assertion"),
    "header-token"
  );
});
