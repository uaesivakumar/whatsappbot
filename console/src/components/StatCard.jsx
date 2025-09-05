export default function StatCard({ label, value, right }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="text-neutral-400 text-sm">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-3xl font-bold">{value}</div>
        {right}
      </div>
    </div>
  );
}
