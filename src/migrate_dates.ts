import { assert } from "@std/assert"
import { DateTime } from "@paulaboks/datetime"

if (import.meta.main) {
	const path = Deno.args[0]
	assert(path, "Pass path as argument")
	const c = confirm(`Are you sure you want to change all Date objects from ${path} into datetime strings?`)
	if (!c) {
		Deno.exit(0)
	}

	const kv = await Deno.openKv(path)

	for await (const { key, value } of kv.list({ prefix: [] })) {
		if (typeof value !== "object") {
			continue
		}
		for (const value_key in value) {
			const val = value as Record<string, unknown>
			if (val[value_key] instanceof Date) {
				val[value_key] = new DateTime(val[value_key]).toString()
			}
		}

		await kv.set(key, value)
	}
}
