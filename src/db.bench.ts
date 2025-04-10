import { Database } from "./db.ts"

type Schema = {
	"users": {
		email: string
		name: string
		age: number
	}
}

const db = await Database.open<Schema>("/tmp/bench.db", {})
const user = await db.create_entry("users", {
	name: "a",
	email: "a@a",
	age: 21,
})
for (let i = 0; i < 1000; i += 1) {
	await db.create_entry("users", { name: "a", email: "a@a", age: 21 })
}

Deno.bench("Creating entry", async () => {
	await db.create_entry("users", { name: "a", email: "a@a", age: 21 })
})

Deno.bench("Getting an entry", async () => {
	await db.get_entry("users", user.id)
})

Deno.bench("Getting 1000 entries", async () => {
	await db.get_all_entries("users", 1000)
})

Deno.bench("Getting Infinity entries", async () => {
	await db.get_all_entries("users", Infinity)
})
