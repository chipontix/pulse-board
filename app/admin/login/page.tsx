import { login } from "../actions.ts";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = { invalid: "Wrong username or password.", "too-many-attempts": "Too many attempts, try again later." };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 360 }}>
      <h1>Admin sign-in</h1>
      <form action={login} className="card">
        {error && <p className="error">{ERRORS[error] ?? "Sign-in failed."}</p>}
        <label>Username <input type="text" name="username" autoComplete="username" required /></label>
        <label>Password <input type="password" name="password" autoComplete="current-password" required /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
