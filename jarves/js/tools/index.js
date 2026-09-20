/**
 * tools/index.js — the tool registry.
 *
 * Every tool is declared in Anthropic's tool-use schema shape (name /
 * description / input_schema) so that the day the Claude brain is wired up,
 * `describe()` can be handed straight to the API with no translation, and
 * `run()` can service a tool_use block as-is. The local brain calls the exact
 * same `run()`, so both brains exercise identical code paths.
 */

const registry = new Map();

export function register(tool) {
  if (!tool?.name || typeof tool.run !== 'function') {
    throw new Error('A tool needs a name and a run().');
  }
  registry.set(tool.name, tool);
  return tool;
}

export function get(name) {
  return registry.get(name);
}

export function all() {
  return [...registry.values()];
}

/** The tool list, in the shape the Messages API expects. */
export function describe() {
  return all().map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema: input_schema || { type: 'object', properties: {} },
  }));
}

/**
 * Run a tool by name. Never throws — a failure comes back as a result the
 * brain can read and explain, which is what the API's is_error path wants too.
 */
export async function run(name, input = {}) {
  const tool = registry.get(name);
  if (!tool) return { ok: false, error: `No tool called "${name}".` };
  try {
    const result = await tool.run(input);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
