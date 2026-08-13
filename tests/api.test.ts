import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../server.js";

describe("Trader AI API Integration Tests", () => {
  it("GET /api/health returns status ok and trader service info", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("service", "trader-ai-api");
    expect(res.headers).toHaveProperty("x-ratelimit-limit");
  });

  it("POST /api/gemini/ask returns 400 when prompt is missing", async () => {
    const res = await request(app).post("/api/gemini/ask").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Bad Request");
  });

  it("POST /api/gemini/ask returns valid response for financial prompt", async () => {
    const res = await request(app)
      .post("/api/gemini/ask")
      .send({ prompt: "Analyze AAPL Q3 earnings outlook." });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("response");
  });

  it("POST /api/market/analysis returns 400 when ticker is missing", async () => {
    const res = await request(app).post("/api/market/analysis").send({});
    expect(res.status).toBe(400);
  });

  it("GET /api/quote/:ticker returns market quote", async () => {
    const res = await request(app).get("/api/quote/AAPL");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ticker", "AAPL");
    expect(res.body).toHaveProperty("price");
  });
});
