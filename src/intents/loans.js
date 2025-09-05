export async function handle(_text, { waId, memory, profile }) {
  const haveCompany = !!profile?.company;
  const haveSalary  = !!profile?.salary_aed;

  const intro = "💼 Loans — I can estimate eligibility fast.";
  const known = [
    haveCompany ? `• Company: ${profile.company}` : null,
    haveSalary  ? `• Salary: AED ${Number(profile.salary_aed).toLocaleString()}` : null,
  ].filter(Boolean);

  const need = [
    haveCompany ? null : "• Company name",
    haveSalary  ? null : "• Monthly salary (AED)",
    "• Current liabilities (cards/loans — approx.)"
  ].filter(Boolean);

  return [
    intro,
    known.length ? "Your saved details:\n" + known.join("\n") : null,
    need.length ? "Please share:\n" + need.join("\n") : "Great — I’ll run numbers and reply with eligible amount, rate, and next steps."
  ].filter(Boolean).join("\n\n");
}
