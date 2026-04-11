const ITEMS = ["File", "Edit", "View", "Loan", "Forms", "Services", "Tools", "Help"];
export function MenuBar() {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] text-[11px]">
      {ITEMS.map((i) => (
        <span key={i} className="mr-3"><u>{i[0]}</u>{i.slice(1)}</span>
      ))}
    </div>
  );
}
