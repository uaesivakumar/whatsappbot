export async function handle(_text, { waId, memory, profile }) {
  const haveCompany = !!profile?.company;
  const haveSalary  = !!profile?.salary_aed;
  const havePref    = !!profile?.prefers;

  const intro = "💳 Credit Cards — I’ll suggest the best fit.";
  const known = [
    haveCompany ? `• Company: ${profile.company}` : null,
    haveSalary  ? `• Salary: AED ${Number(profile.salary_aed).toLocaleString()}` : null,
    havePref    ? `• Preference: ${profile.prefers}` : null
  ].filter(Boolean);

  const need = [
    haveCompany ? null : "• Company name",
    haveSalary  ? null : "• Monthly salary (AED)",
    havePref    ? null : "• Priority: Cashback / Travel / No annual fee"
  ].filter(Boolean);

  const closing = "I’ll reply with 1–2 options and a quick benefits summary.";

  return [
    intro,
    known.length ? "Your saved details:\n" + known.join("\n") : null,
    need.length ? "Please share:\n" + need.join("\n") : "Perfect — using your profile, I’ll tailor the options.",
    closing
  ].filter(Boolean).join("\n\n");
}
