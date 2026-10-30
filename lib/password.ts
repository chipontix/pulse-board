import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384, R = 8, P = 1, LEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, fail) =>
    scrypt(password, salt, LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? fail(e) : ok(k))),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64url), so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}
