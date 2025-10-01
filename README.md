# Boksy

Simple database using Deno.Kv

## Examples

```ts
import { z } from "npm:zod/v4"
import { Database } from "jsr:@paulaboks/boksy"

// First declare a schema for your db
const schema = z.object({
	"users": z.object({
		email: z.string(),
		name: z.string(),
		age: z.number(),
	}),
	"books": z.object({
		user_id: z.string(),
		name: z.string(),
		content: z.string(),
	}),
})

// Then open your database
// The second argument is a object where the keys are names of tables
// and the values are arrays with columns to be indexed
// Normally you can only find entries by their id, indexes allow us to get by other columns
// If you change this object to add new indexes, they will be created on old entries as well
const db = await Database.open<z.infer<typeof schema>>(":memory:", schema, {
	users: ["email"],
	books: ["user_id"],
})
// So here we can access our users by their email (there's nothing to enforce them to be unique!)
// And we can access all books with a certain user_id

// Create an user, this will set id and date_created columns
await db.create_entry("users", {
	name: "paula",
	email: "p@p",
	age: 32,
})

// Find our user by email
const user = await db.get_entry_by_index("users", "email", "p@p")
console.log(user)

// Create 2 books
await db.create_entry("books", { user_id: user.id, name: "Cool book", content: "" })
await db.create_entry("books", { user_id: user.id, name: "Cool book the sequel", content: "" })

// And get those 2 books using our user's id
const books_by_user = await db.get_entries_by_index("books", "user_id", user.id)
console.log(books_by_user.map((book) => book.name))
```
