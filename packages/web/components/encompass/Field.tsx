export function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="enc-field">
      <label>{label}</label>
      <div className="v">{value}</div>
    </div>
  );
}
