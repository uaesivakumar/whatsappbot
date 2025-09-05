export async function handle(text, { waId, memory }) {
  return [
    "🏦 **Accounts**",
    "We can open salary/current accounts quickly.",
    "Share company, salary transfer (Y/N), and Emirates ID status."
  ].join("\n");
}
