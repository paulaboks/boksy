/// <reference lib="deno.unstable" />

import { ulid } from "jsr:@std/ulid"

export interface Model {
	id: string
	date_created: Date
}

export const db: Deno.Kv = await Deno.openKv(
	Deno.env.get("CMG_DB_PATH") ?? "./cmg.db",
)

/// Takes in a db model (without an id), generates a ulid, adds that id to the object
/// Then stores on the kv as [table, id] = object, returns the id
export async function create_entry<T extends Model>(
	table_name: string,
	value: Omit<T, "id" | "date_created">,
): Promise<Partial<T>> {
	const id = ulid()
	const date_created = new Date()

	const entry = { id, date_created, ...value } as T
	await db.atomic().set([table_name, id], entry).commit()

	await create_indexes_for_entry(table_name, entry)

	return entry
}

/// Takes in a db model (with an id) and updates it on the kv
export async function update_entry<T extends Model>(
	table_name: string,
	entry: Partial<T>,
) {
	await db.atomic().set([table_name, entry["id"] as string], entry).commit()
	// Create/set should be the same
	await create_indexes_for_entry(table_name, entry)
}

export async function get_from_key<T>(
	key: Deno.KvKey,
): Promise<Deno.KvEntry<T> | undefined> {
	const entry = await db.get(key)
	if (entry.versionstamp == null) {
		return undefined
	}
	return entry as Deno.KvEntry<T>
}

/// Gets the Deno.KvEntry for the id on the table
export async function get_entry_full<T extends Model>(
	table_name: string,
	id: string,
): Promise<Deno.KvEntry<Partial<T>> | undefined> {
	/*const entry = await db.get([table_name, id])
	if (entry.versionstamp == null) {
		return undefined
	}
	return entry as Deno.KvEntry<T>*/
	return await get_from_key([table_name, id])
}

/// Gets just the value for the id on the table
export async function get_entry<T extends Model>(
	table_name: string,
	id: string,
): Promise<Partial<T> | undefined> {
	return (await get_from_key<T>([table_name, id]))?.value
}

export async function get_all_from_key<T>(
	key: Deno.KvKey,
	limit?: number | undefined,
): Promise<Deno.KvEntry<Partial<T>>[]> {
	const entries = db.list({ prefix: key }, { limit: limit ?? Infinity })
	const array = await Array.fromAsync(entries)
	return array as Deno.KvEntry<Partial<T>>[]
}

export async function get_all_entries_full<T extends Model>(
	table_name: string,
	limit?: number | undefined,
): Promise<Deno.KvEntry<Partial<T>>[]> {
	const entries = db.list({ prefix: [table_name] }, {
		limit: limit ?? Infinity,
	})
	const array = await Array.fromAsync(entries)
	return array as Deno.KvEntry<Partial<T>>[]
}

/// Gets a list of all entries from a table
export async function get_all_entries<T extends Model>(
	table_name: string,
	limit?: number | undefined,
): Promise<Partial<T>[]> {
	const entries = db.list({ prefix: [table_name] }, {
		limit: limit ?? Infinity,
	})
	const array = await Array.fromAsync(entries, (entry) => entry.value)
	return array as T[]
}

// Index stuff

// Creates an index for the table on the seconday key
// Internally creates a ["__indexes", table_name, secondary_key, secondary_key_value] key
// that is set to the primary key for the entry
export async function create_index<T extends Model>(
	table_name: string,
	secondary_key: keyof T,
) {
	if (await get_from_key(["__indexes_for", table_name, secondary_key])) {
		return
	}

	await db.atomic().set(
		["__indexes_for", table_name, secondary_key],
		secondary_key,
	).commit()

	for (const entry of await get_all_entries<T>(table_name)) {
		const key = entry[secondary_key]
		if (key) {
			await db.atomic().set([
				"__indexes",
				table_name,
				secondary_key,
				key as Deno.KvKeyPart,
				entry.id!,
			], entry.id).commit()
		}
	}
}

// Creates all the indexes for an entry on a table
// This checks ["__indexes_for", table_name] to see all the indexes a table needs,
// and created the kv pair leading to the primary key
export async function create_indexes_for_entry<T extends Model>(
	table_name: string,
	value: Partial<T>,
) {
	const indexes_to_create = db.list<string>({
		prefix: ["__indexes_for", table_name],
	})

	for await (const secondary_key of indexes_to_create) {
		const secondary_key_value = value[secondary_key.value as keyof T]

		await db.atomic().set(
			[
				"__indexes",
				table_name,
				secondary_key.value,
				secondary_key_value as Deno.KvKeyPart,
				value.id!,
			],
			value["id"],
		)
			.commit()
	}
}

// Uses the secondary key to get the primary key from the index, then returns all entries matching
export async function get_entries_by_index<T extends Model>(
	table_name: string,
	secondary_key: string,
	secondary_key_value: Deno.KvKeyPart,
): Promise<Partial<T>[]> {
	const entries = await get_all_from_key<string>([
		"__indexes",
		table_name,
		secondary_key,
		secondary_key_value,
	])
	return await Array.fromAsync(
		entries,
		async (entry) => (await get_entry(table_name, entry.value))!,
	)
}
