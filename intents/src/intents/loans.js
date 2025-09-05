export async function handle(text, { waId, memory }) {
  return [
    "💼 **Loans**",
    "To guide you well, please share:",
    "• Company name  • Monthly salary  • Current liabilities (if any)",
    "I’ll estimate eligibility and next steps in Siva style."
  ].join("\n");
}
