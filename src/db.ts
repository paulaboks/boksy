/// <reference lib="deno.unstable" />

import { ulid } from "jsr:@std/ulid"

export interface Model {
	id: string
	date_created: Date
}

type Schema = Record<string, unknown>

type DBSchema = Record<string, Schema>

type ExtractTables<S extends DBSchema> = keyof S
type ExtractSchema<S extends DBSchema, table extends ExtractTables<S>> = S[table]

type IntoModel<S extends Schema> = Model & S
type ExtractModel<S extends DBSchema, table extends ExtractTables<S>> = IntoModel<S[table]>

type IncompleteModel<S extends DBSchema, table extends ExtractTables<S>> = Omit<
	ExtractModel<S, table>,
	"id" | "date_created"
>

type KeyOfSchema<S extends DBSchema> = keyof ExtractSchema<S, ExtractTables<S>>
type Indexes<S extends DBSchema> = Partial<
	Record<ExtractTables<S>, (KeyOfSchema<S>)[]>
>

export class Database<S extends DBSchema> {
	kv: Deno.Kv
	indexes: Indexes<S>

	constructor(kv: Deno.Kv, indexes: Indexes<S>) {
		this.kv = kv
		this.indexes = indexes

		this.#init_indexes()
	}

	static async open<S extends DBSchema>(path: string, indexes: Indexes<S>) {
		return new Database<S>(await Deno.openKv(path), indexes)
	}

	#init_indexes() {
		for (const table in this.indexes) {
			for (const secondary_key of this.indexes[table]!) {
				this.create_index(table, secondary_key)
			}
		}
	}

	/// Takes in a db model (without an id), generates a ulid, adds that id to the object
	/// Then stores on the kv as [table, id] = object, returns the id
	async create_entry<table extends ExtractTables<S>>(
		table_name: table,
		value: IncompleteModel<S, table>,
	): Promise<ExtractModel<S, table>> {
		const id = ulid()
		const date_created = new Date()

		const entry = { id, date_created, ...value }
		await this.kv.atomic().set([table_name, id], entry).commit()

		await this.create_indexes_for_entry(
			table_name,
			entry as ExtractModel<S, table>,
		)

		return entry as ExtractModel<S, table>
	}

	/// Takes in a db model (with an id) and updates it on the kv
	async update_entry<table extends ExtractTables<S>>(
		table_name: table,
		entry: Partial<ExtractModel<S, table>>,
	) {
		await this.kv.atomic().set([table_name, entry["id"] as string], entry)
			.commit()
		// Create/set should be the same
		await this.create_indexes_for_entry(table_name, entry)
	}

	async get_from_key<T>(
		key: Deno.KvKey,
	): Promise<Deno.KvEntry<T> | undefined> {
		const entry = await this.kv.get(key)
		if (entry.versionstamp == null) {
			return undefined
		}
		return entry as Deno.KvEntry<T>
	}

	/// Gets the Deno.KvEntry for the id on the table
	async get_entry_full<table extends ExtractTables<S>>(
		table_name: table,
		id: string,
	): Promise<Deno.KvEntry<Partial<ExtractModel<S, table>>> | undefined> {
		return await this.get_from_key([table_name, id])
	}

	/// Gets just the value for the id on the table
	async get_entry<table extends ExtractTables<S>>(
		table_name: table,
		id: string,
	): Promise<Partial<ExtractModel<S, table>> | undefined> {
		return (await this.get_from_key<ExtractModel<S, table>>([table_name, id]))
			?.value
	}

	async get_all_from_key<T>(
		key: Deno.KvKey,
		limit: number,
	): Promise<Deno.KvEntry<Partial<T>>[]> {
		const entries = this.kv.list({ prefix: key }, { limit })
		const array = await Array.fromAsync(entries)
		return array as Deno.KvEntry<Partial<T>>[]
	}

	async get_all_entries_full<table extends ExtractTables<S>>(
		table_name: table,
		limit?: number | undefined,
	): Promise<Deno.KvEntry<Partial<ExtractModel<S, table>>>[]> {
		const entries = this.kv.list<ExtractModel<S, table>>({
			prefix: [table_name],
		}, {
			limit,
		})
		const array = await Array.fromAsync(entries)
		return array
	}

	/// Gets a list of all entries from a table
	async get_all_entries<table extends ExtractTables<S>>(
		table_name: table,
		limit?: number | undefined,
	): Promise<Partial<ExtractModel<S, table>>[]> {
		const entries = this.kv.list<ExtractModel<S, table>>({
			prefix: [table_name],
		}, {
			limit: limit ?? Infinity,
		})
		const array = await Array.fromAsync(entries, (entry) => entry.value)
		return array
	}

	// Index stuff

	// Creates an index for the table on the seconday key
	// Internally creates a ["__indexes", table_name, secondary_key, secondary_key_value] key
	// that is set to the primary key for the entry
	async create_index<table extends ExtractTables<S>>(
		table_name: table,
		secondary_key: keyof ExtractModel<S, table>,
	) {
		if (await this.get_from_key(["__indexes_for", table_name, secondary_key])) {
			return
		}

		await this.kv.set(
			["__indexes_for", table_name, secondary_key],
			secondary_key,
		)

		for (const entry of await this.get_all_entries(table_name)) {
			const key = entry[secondary_key]
			if (key) {
				await this.kv.atomic().set([
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
	async create_indexes_for_entry<
		table extends ExtractTables<S>,
		Model extends ExtractModel<S, table>,
	>(
		table_name: table,
		value: Partial<Model>,
	) {
		const indexes_to_create = this.kv.list<string>({
			prefix: ["__indexes_for", table_name],
		})

		for await (const secondary_key of indexes_to_create) {
			const secondary_key_value = value[secondary_key.value as keyof Model]

			await this.kv.atomic().set(
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
	async get_entries_by_index<table extends ExtractTables<S>>(
		table_name: table,
		secondary_key: string,
		secondary_key_value: Deno.KvKeyPart,
	): Promise<Partial<ExtractModel<S, table>>[]> {
		const entries = await this.get_all_from_key<string>([
			"__indexes",
			table_name,
			secondary_key,
			secondary_key_value,
		], Infinity)
		return await Array.fromAsync(
			entries,
			async (entry) => (await this.get_entry<table>(table_name, entry.value))!,
		)
	}

	async get_entry_by_index<table extends ExtractTables<S>>(
		table_name: table,
		secondary_key: keyof ExtractSchema<S, table>,
		secondary_key_value: Deno.KvKeyPart,
	): Promise<Partial<ExtractModel<S, table>> | undefined> {
		const entries = await this.get_all_from_key<string>([
			"__indexes",
			table_name,
			secondary_key,
			secondary_key_value,
		], Infinity)
		return await this.get_entry<table>(table_name, entries[0]?.value)
	}
}
