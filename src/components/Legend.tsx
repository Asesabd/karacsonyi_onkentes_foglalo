const ITEMS = [
  { swatch: "bg-white border-2 border-xmas-green", icon: "○", label: "Szabad" },
  { swatch: "bg-xmas-green", icon: "✓", label: "Kiválasztott", textClass: "text-white" },
  { swatch: "bg-amber-300", icon: "🔒", label: "Ideiglenesen zárolt" },
  { swatch: "bg-gray-400", icon: "✕", label: "Foglalt", textClass: "text-white" },
];

export default function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700" aria-label="Jelmagyarázat">
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${item.swatch} ${item.textClass ?? "text-xmas-green"}`}
            aria-hidden="true"
          >
            {item.icon}
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
