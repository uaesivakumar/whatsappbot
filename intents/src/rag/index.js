// Placeholder RAG wrapper; return null to let server fallback if no hit.
export async function answer(query, { memory = [], userId } = {}) {
  // TODO: wire to your vector DB / KB. For now, return null to skip.
  return null;
}
export default { answer };
