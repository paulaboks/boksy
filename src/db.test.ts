import { Database } from "./db.ts"

import { assert, assertEquals } from "jsr:@std/assert"

type Schema = {
	"users": {
		email: string
		name: string
		age: number
	}
	"empty": Record<string, unknown>
}

Deno.test("Creating and getting entries", async () => {
	const db = await Database.open<Schema>(":memory:", {})

	const user1 = await db.create_entry("users", {
		"email": "a@a",
		"name": "a",
		"age": 1,
	})
	const user2 = await db.create_entry("users", {
		"email": "b@b",
		"name": "b",
		"age": 2,
	})

	const user_db1 = await db.get_entry("users", user1.id)
	const user_db2 = await db.get_entry("users", user2.id)

	assertEquals(user1, user_db1)
	assertEquals(user2, user_db2)

	db.kv.close()
})

Deno.test("Updating entry", async () => {
	const db = await Database.open<Schema>(":memory:", {})

	const user = await db.create_entry("users", {
		"email": "a@a",
		"name": "a",
		"age": 1,
	})

	user.email = "b@b"

	await db.update_entry("users", user)

	const user_db = await db.get_entry("users", user.id)

	assertEquals(user, user_db)

	db.kv.close()
})

Deno.test("Listing all entries", async () => {
	const db = await Database.open<Schema>(":memory:", {})

	const empty1 = await db.create_entry("empty", {})
	const empty2 = await db.create_entry("empty", {})
	const empty3 = await db.create_entry("empty", {})

	const list = [empty1, empty2, empty3].toSorted((a, b) => a.id.localeCompare(b.id))
	const list_db = await db.get_all_entries("empty")

	assertEquals(list, list_db)

	db.kv.close()
})

Deno.test("Indexing", async () => {
	const db = await Database.open<Schema>(
		":memory:",
		{ users: ["email"] } as const,
	)

	const user = await db.create_entry("users", {
		name: "a",
		email: "a@a",
		age: 23,
	})

	const entry = await db.get_entry_by_index("users", "email", "a@a")
	assertEquals(user, entry)

	db.kv.close()
})
