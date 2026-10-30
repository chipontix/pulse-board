// node scripts/migrate.ts [up | down [steps]]
import { db } from "../lib/db.ts";
import { migrateDown, migrateUp } from "../lib/migrate.ts";

const [cmd = "up", steps = "1"] = process.argv.slice(2);
const done = cmd === "down" ? await migrateDown(db(), Number(steps)) : await migrateUp(db());
console.log(`migrate ${cmd}: ${done.length ? done.join(", ") : "nothing to do"}`);
await db().end();
