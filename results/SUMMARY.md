## Public page (autocannon, 50 connections, 30 s per run)

| mode | runs | req/s | p50 ms | p95 ms | p99 ms | cache hit rate | Postgres tx/s | non-2xx |
|---|---|---|---|---|---|---|---|---|
| nocache | 3 | 69–80 | 574.3–671.8 | 974.7–1110.8 | 1261.1–1332.0 | n/a (cache off) | 217–247 | 0 |
| cache | 3 | 347–468 | 101.5–126.9 | 143.9–262.4 | 261.8–487.3 | 100.00% | 5 | 0 |
| cache-invalidate-1s | 3 | 360–457 | 98.2–108.7 | 157.5–320.0 | 204.6–692.4 | 86.73%–89.91% | 8 | 0 |

Cache on vs off, same repetition: throughput ×5.0–5.8, p95 ÷3.8–6.8.

Snapshot queries alone (30 sequential loads before each run): p50 34.7–40.5 ms, p95 42.9–107.6 ms.

## SSE fan-out (budget p95 < 500 ms and 100% delivered; 20 events, one per 500 ms)

| run | clients | delivered | p50 ms | p95 ms | p99 ms | max ms | within budget |
|---|---|---|---|---|---|---|---|
| r1 | 500 | 100% | 27 | 94 | 263 | 282 | yes |
| r1 | 1000 | 100% | 42 | 233 | 307 | 320 | yes |
| r1 | 1500 | 100% | 81 | 599 | 788 | 813 | **no** |
| r2 | 500 | 100% | 55 | 344 | 402 | 425 | yes |
| r2 | 1000 | 100% | 61 | 192 | 219 | 228 | yes |
| r2 | 1500 | 100% | 96 | 677 | 980 | 1104 | **no** |
| r3 | 500 | 100% | 31 | 189 | 476 | 480 | yes |
| r3 | 1000 | 100% | 50 | 503 | 959 | 1026 | **no** |

Largest client count within budget per run: 1000, 1000, 500.
